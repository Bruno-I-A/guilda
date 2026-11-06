import "server-only";

import { randomUUID } from "node:crypto";

import { and, eq } from "drizzle-orm";

import { withOrgTx } from "@/db/org-tx";
import * as schema from "@/db/schema";

import type { MetaPhoneNumber } from "./meta-client";
import {
  decryptWhatsAppToken,
  encryptWhatsAppToken,
  type WhatsAppTokenEnvelope,
} from "./token-vault";

export type WhatsAppChannelSummary = Readonly<{
  id: string;
  name: string;
  status: "pending" | "active" | "paused" | "disconnected";
  wabaId: string;
  phoneNumberId: string;
  displayPhoneNumber?: string;
  verifiedName?: string;
  coexistenceEnabled: boolean;
}>;

function channelName(phone: MetaPhoneNumber): string {
  return phone.verifiedName?.trim() || phone.displayPhoneNumber?.trim() || "WhatsApp";
}

export async function persistPendingWhatsAppChannel(input: {
  orgId: string;
  userId: string;
  wabaId: string;
  phone: MetaPhoneNumber;
  accessToken: string;
}): Promise<WhatsAppChannelSummary> {
  return withOrgTx(input.orgId, async (tx) => {
    const existing = await tx.query.supportWhatsAppChannels.findFirst({
      where: and(
        eq(schema.supportWhatsAppChannels.orgId, input.orgId),
        eq(schema.supportWhatsAppChannels.phoneNumberId, input.phone.id),
      ),
    });
    const channelId = existing?.id ?? randomUUID();
    const envelope = encryptWhatsAppToken(input.accessToken, {
      orgId: input.orgId,
      channelId,
    });
    if (!envelope) throw new Error("Cofre do token do WhatsApp não configurado.");
    const now = new Date();
    const values = {
      name: channelName(input.phone),
      status: "pending" as const,
      wabaId: input.wabaId,
      phoneNumberId: input.phone.id,
      displayPhoneNumber: input.phone.displayPhoneNumber ?? null,
      verifiedName: input.phone.verifiedName ?? null,
      coexistenceEnabled: true,
      accessTokenCiphertext: envelope.ciphertext,
      accessTokenIv: envelope.iv,
      accessTokenAuthTag: envelope.authTag,
      accessTokenKeyVersion: envelope.keyVersion,
      updatedAt: now,
    };
    if (existing) {
      await tx
        .update(schema.supportWhatsAppChannels)
        .set(values)
        .where(
          and(
            eq(schema.supportWhatsAppChannels.orgId, input.orgId),
            eq(schema.supportWhatsAppChannels.id, channelId),
          ),
        );
    } else {
      await tx.insert(schema.supportWhatsAppChannels).values({
        id: channelId,
        orgId: input.orgId,
        createdBy: input.userId,
        ...values,
      });
    }
    return {
      id: channelId,
      name: values.name,
      status: values.status,
      wabaId: input.wabaId,
      phoneNumberId: input.phone.id,
      ...(input.phone.displayPhoneNumber
        ? { displayPhoneNumber: input.phone.displayPhoneNumber }
        : {}),
      ...(input.phone.verifiedName ? { verifiedName: input.phone.verifiedName } : {}),
      coexistenceEnabled: true,
    };
  });
}

export async function activateWhatsAppChannel(
  orgId: string,
  channelId: string,
): Promise<WhatsAppChannelSummary | null> {
  return withOrgTx(orgId, async (tx) => {
    const [channel] = await tx
      .update(schema.supportWhatsAppChannels)
      .set({ status: "active", onboardedAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(schema.supportWhatsAppChannels.orgId, orgId),
          eq(schema.supportWhatsAppChannels.id, channelId),
        ),
      )
      .returning();
    return channel?.wabaId && channel.phoneNumberId
      ? {
          id: channel.id,
          name: channel.name,
          status: channel.status,
          wabaId: channel.wabaId,
          phoneNumberId: channel.phoneNumberId,
          ...(channel.displayPhoneNumber
            ? { displayPhoneNumber: channel.displayPhoneNumber }
            : {}),
          ...(channel.verifiedName ? { verifiedName: channel.verifiedName } : {}),
          coexistenceEnabled: channel.coexistenceEnabled,
        }
      : null;
  });
}

export async function loadWhatsAppChannelAccess(input: {
  orgId: string;
  channelId: string;
}): Promise<{ channel: WhatsAppChannelSummary; accessToken: string } | null> {
  return withOrgTx(input.orgId, async (tx) => {
    const channel = await tx.query.supportWhatsAppChannels.findFirst({
      where: and(
        eq(schema.supportWhatsAppChannels.orgId, input.orgId),
        eq(schema.supportWhatsAppChannels.id, input.channelId),
      ),
    });
    if (
      !channel?.wabaId ||
      !channel.phoneNumberId ||
      !channel.accessTokenCiphertext ||
      !channel.accessTokenIv ||
      !channel.accessTokenAuthTag ||
      channel.accessTokenKeyVersion !== 1
    ) {
      return null;
    }
    const envelope: WhatsAppTokenEnvelope = {
      ciphertext: channel.accessTokenCiphertext,
      iv: channel.accessTokenIv,
      authTag: channel.accessTokenAuthTag,
      keyVersion: 1,
    };
    const accessToken = decryptWhatsAppToken(envelope, {
      orgId: input.orgId,
      channelId: channel.id,
    });
    if (!accessToken) return null;
    return {
      accessToken,
      channel: {
        id: channel.id,
        name: channel.name,
        status: channel.status,
        wabaId: channel.wabaId,
        phoneNumberId: channel.phoneNumberId,
        ...(channel.displayPhoneNumber
          ? { displayPhoneNumber: channel.displayPhoneNumber }
          : {}),
        ...(channel.verifiedName ? { verifiedName: channel.verifiedName } : {}),
        coexistenceEnabled: channel.coexistenceEnabled,
      },
    };
  });
}
