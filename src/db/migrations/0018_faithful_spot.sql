ALTER TABLE "telegram_outbox" ADD COLUMN "lock_token" uuid;--> statement-breakpoint

-- Reserva lotes sem revelar payloads fora do tenant. SKIP LOCKED permite
-- múltiplos workers, enquanto o lease recupera processos interrompidos.
CREATE OR REPLACE FUNCTION public.claim_telegram_outbox(p_limit integer)
RETURNS TABLE(outbox_id uuid, org_id text, claim_token uuid)
LANGUAGE plpgsql
SECURITY DEFINER
VOLATILE
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 100 THEN
    RAISE EXCEPTION 'p_limit deve estar entre 1 e 100';
  END IF;

  RETURN QUERY
  WITH candidates AS (
    SELECT o.id
    FROM public.telegram_outbox AS o
    WHERE o.attempt_count < 5
      AND (
        (o.status = 'pending' AND o.scheduled_for <= statement_timestamp())
        OR (
          o.status = 'processing'
          AND o.locked_at < statement_timestamp() - interval '5 minutes'
        )
      )
    ORDER BY o.scheduled_for, o.created_at
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  ), claimed AS (
    UPDATE public.telegram_outbox AS o
    SET status = 'processing',
        locked_at = statement_timestamp(),
        lock_token = gen_random_uuid(),
        attempt_count = o.attempt_count + 1,
        last_error = NULL
    FROM candidates AS c
    WHERE o.id = c.id
    RETURNING o.id, o.org_id, o.lock_token
  )
  SELECT c.id, c.org_id, c.lock_token
  FROM claimed AS c;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.claim_telegram_outbox(integer) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.claim_telegram_outbox(integer) TO guilda_app;--> statement-breakpoint

-- O token de lease impede que um worker atrasado finalize um claim que já foi
-- retomado por outro processo. Falhas transitórias recebem backoff exponencial.
CREATE OR REPLACE FUNCTION public.finish_telegram_outbox(
  p_outbox_id uuid,
  p_claim_token uuid,
  p_success boolean,
  p_error text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
VOLATILE
SET search_path = pg_catalog, public
AS $$
DECLARE
  affected integer;
BEGIN
  UPDATE public.telegram_outbox AS o
  SET status = CASE
        WHEN p_success THEN 'sent'::public.telegram_outbox_status
        WHEN o.attempt_count >= 5 THEN 'failed'::public.telegram_outbox_status
        ELSE 'pending'::public.telegram_outbox_status
      END,
      sent_at = CASE WHEN p_success THEN statement_timestamp() ELSE NULL END,
      scheduled_for = CASE
        WHEN p_success OR o.attempt_count >= 5 THEN o.scheduled_for
        ELSE statement_timestamp() + make_interval(
          secs => LEAST(3600, 30 * power(2, GREATEST(o.attempt_count - 1, 0)))::integer
        )
      END,
      last_error = CASE
        WHEN p_success THEN NULL
        ELSE left(COALESCE(NULLIF(p_error, ''), 'Falha desconhecida'), 2000)
      END,
      locked_at = NULL,
      lock_token = NULL
  WHERE o.id = p_outbox_id
    AND o.status = 'processing'
    AND o.lock_token = p_claim_token;

  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected = 1;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.finish_telegram_outbox(uuid, uuid, boolean, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.finish_telegram_outbox(uuid, uuid, boolean, text) TO guilda_app;
--> statement-breakpoint

-- Adia um lease sem consumir tentativa (usado durante o período silencioso).
CREATE OR REPLACE FUNCTION public.defer_telegram_outbox(
  p_outbox_id uuid,
  p_claim_token uuid,
  p_minutes integer DEFAULT 15
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
VOLATILE
SET search_path = pg_catalog, public
AS $$
DECLARE
  affected integer;
BEGIN
  IF p_minutes IS NULL OR p_minutes < 1 OR p_minutes > 1440 THEN
    RAISE EXCEPTION 'p_minutes deve estar entre 1 e 1440';
  END IF;

  UPDATE public.telegram_outbox AS o
  SET status = 'pending'::public.telegram_outbox_status,
      scheduled_for = statement_timestamp() + make_interval(mins => p_minutes),
      attempt_count = GREATEST(0, o.attempt_count - 1),
      locked_at = NULL,
      lock_token = NULL
  WHERE o.id = p_outbox_id
    AND o.status = 'processing'
    AND o.lock_token = p_claim_token;

  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected = 1;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.defer_telegram_outbox(uuid, uuid, integer) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.defer_telegram_outbox(uuid, uuid, integer) TO guilda_app;
