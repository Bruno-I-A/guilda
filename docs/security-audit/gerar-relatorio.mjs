/**
 * Gerador do relatório de auditoria de segurança (HTML -> PDF).
 *
 * Uso:  node docs/security-audit/gerar-relatorio.mjs
 *
 * Não instala nada: usa o Chromium que já vem com a devDependency `playwright`
 * do próprio projeto. Os dados vivem em `dados.mjs` — editar lá e rodar de novo
 * regera o PDF. Gera também o HTML intermediário, útil para inspeção rápida no
 * navegador e para rasterizar as páginas durante a conferência visual.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";

import {
  achados,
  categorias,
  COR_PONTO_FORTE,
  issues,
  meta,
  pontosFortes,
  pontosFracos,
  recomendacoes,
  SEVERIDADES,
} from "./dados.mjs";
import {
  correcaoF4,
  ESTADOS,
  pentest,
  revisao,
  statusPorAchado,
} from "./dados-rev2.mjs";

const AQUI = dirname(fileURLToPath(import.meta.url));
const SAIDA_HTML = join(AQUI, "relatorio-auditoria-seguranca.html");
const SAIDA_PDF = join(AQUI, "relatorio-auditoria-seguranca.pdf");

// ── utilidades ──────────────────────────────────────────────────────────────

const esc = (s) =>
  String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

/** Negrito de markdown (`**x**`) e código inline (`` `x` ``) em texto já escapado. */
const rico = (s) =>
  esc(s)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`]+)`/g, "<code>$1</code>");

const chip = (sev) => {
  const { rotulo, cor } = SEVERIDADES[sev];
  return `<span class="chip" style="background:${cor}">${rotulo}</span>`;
};

/** Selo de estado de remediação (corrigido / mitigado / pendente). */
const selo = (id) => {
  const st = statusPorAchado[id];
  if (!st) return "";
  const { rotulo, cor } = ESTADOS[st.estado];
  return `<span class="selo" style="color:${cor};border-color:${cor}">${rotulo}</span>`;
};

// ── gráficos (SVG puro, sem dependência externa) ────────────────────────────

function graficoRosca(contagens) {
  const entradas = Object.entries(SEVERIDADES)
    .sort((a, b) => a[1].ordem - b[1].ordem)
    .map(([chave, def]) => ({ ...def, chave, valor: contagens[chave] ?? 0 }))
    .filter((e) => e.valor > 0);

  const total = entradas.reduce((soma, e) => soma + e.valor, 0);
  const cx = 110;
  const cy = 110;
  const raioExterno = 92;
  const raioInterno = 56;
  const vao = 0.016; // radianos de respiro entre fatias

  let angulo = -Math.PI / 2;
  const fatias = entradas
    .map((e) => {
      const varredura = (e.valor / total) * Math.PI * 2;
      const inicio = angulo + vao / 2;
      const fim = angulo + varredura - vao / 2;
      angulo += varredura;

      const p = (r, a) => `${(cx + r * Math.cos(a)).toFixed(2)} ${(cy + r * Math.sin(a)).toFixed(2)}`;
      const grande = varredura - vao > Math.PI ? 1 : 0;
      const d = [
        `M ${p(raioExterno, inicio)}`,
        `A ${raioExterno} ${raioExterno} 0 ${grande} 1 ${p(raioExterno, fim)}`,
        `L ${p(raioInterno, fim)}`,
        `A ${raioInterno} ${raioInterno} 0 ${grande} 0 ${p(raioInterno, inicio)}`,
        "Z",
      ].join(" ");
      return `<path d="${d}" fill="${e.cor}" />`;
    })
    .join("\n      ");

  const legenda = entradas
    .map(
      (e) => `<li><span class="ponto" style="background:${e.cor}"></span>
        <span class="leg-rotulo">${e.rotulo}</span>
        <span class="leg-valor">${e.valor}</span></li>`,
    )
    .join("\n      ");

  return `<div class="grafico">
    <svg viewBox="0 0 220 220" width="200" height="200" role="img" aria-label="Achados por severidade">
      ${fatias}
      <text x="${cx}" y="${cy - 6}" text-anchor="middle" class="rosca-num">${total}</text>
      <text x="${cx}" y="${cy + 14}" text-anchor="middle" class="rosca-txt">achados</text>
    </svg>
    <ul class="legenda">
      ${legenda}
    </ul>
  </div>`;
}

function graficoBarras() {
  // A cor de cada barra é a severidade MAIS ALTA daquela categoria — assim o
  // gráfico responde “quantos” e “quão grave” na mesma leitura.
  const linhas = categorias.map((c) => {
    const daCategoria = achados.filter((a) => a.categoria === c.id);
    const pior = daCategoria.reduce(
      (acc, a) =>
        acc === null || SEVERIDADES[a.severidade].ordem < SEVERIDADES[acc].ordem
          ? a.severidade
          : acc,
      null,
    );
    return {
      rotulo: `${c.id}. ${c.titulo.split("—")[0].trim()}`,
      valor: daCategoria.length,
      cor: pior ? SEVERIDADES[pior].cor : "#cbd5e1",
    };
  });
  const maximo = Math.max(1, ...linhas.map((l) => l.valor));

  const largura = 300;
  const alturaBarra = 20;
  const espaco = 15;
  const rotuloW = 168;
  const altura = linhas.length * (alturaBarra + espaco);

  const corpo = linhas
    .map((l, i) => {
      const y = i * (alturaBarra + espaco);
      const w = Math.max(2, (l.valor / maximo) * (largura - rotuloW - 34));
      return `<g>
        <text x="0" y="${y + alturaBarra / 2 + 4}" class="barra-rotulo">${esc(l.rotulo)}</text>
        <rect x="${rotuloW}" y="${y}" width="${w.toFixed(1)}" height="${alturaBarra}" fill="${l.cor}" rx="2" />
        <text x="${rotuloW + w + 7}" y="${y + alturaBarra / 2 + 4}" class="barra-valor">${l.valor}</text>
      </g>`;
    })
    .join("\n      ");

  return `<div class="grafico">
    <svg viewBox="0 0 ${largura} ${altura}" width="330" height="${altura * 1.1}" role="img" aria-label="Achados por categoria">
      ${corpo}
    </svg>
  </div>
  <p class="nota-grafico">Cor da barra = severidade mais alta encontrada na categoria.</p>`;
}

// ── seções ──────────────────────────────────────────────────────────────────

function capa() {
  return `<section class="capa">
    <div class="capa-marca">Auditoria de segurança &middot; Revisão ${esc(revisao.versao)}</div>
    <h1 class="capa-titulo">Relatório de Auditoria de Segurança<br /><span>${esc(meta.projeto)}</span></h1>
    <p class="capa-data">Auditoria: ${esc(meta.data)} &middot; Revisão: ${esc(revisao.data)} &middot; branch <code>${esc(meta.branch)}</code></p>

    <p class="capa-rev">${rico(revisao.nota)}</p>

    <h2 class="capa-h2">Escopo auditado</h2>
    <ul class="capa-lista">
      ${meta.escopo.map((i) => `<li>${rico(i)}</li>`).join("\n      ")}
    </ul>

    <h2 class="capa-h2">Stack detectada</h2>
    <table class="stack">
      ${meta.stack.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${rico(v)}</td></tr>`).join("\n      ")}
    </table>

    <h2 class="capa-h2">Nota metodológica — como cada categoria foi mapeada para esta stack</h2>
    ${meta.metodologia
      .map(
        ([t, d]) => `<div class="metodo"><h3>${esc(t)}</h3><p>${rico(d)}</p></div>`,
      )
      .join("\n    ")}

    <p class="capa-rodape">Todos os achados deste relatório foram verificados no código-fonte real, com arquivo e linha. Nada aqui é especulativo: onde uma categoria não produziu achado, isso está dito explicitamente.</p>
  </section>`;
}

function resumoExecutivo(contagens, porCategoria) {
  const total = achados.length;
  const cards = Object.entries(SEVERIDADES)
    .sort((a, b) => a[1].ordem - b[1].ordem)
    .map(
      ([chave, def]) => `<div class="card-sev" style="border-top-color:${def.cor}">
        <div class="card-num" style="color:${def.cor}">${contagens[chave] ?? 0}</div>
        <div class="card-lbl">${def.rotulo}</div>
      </div>`,
    )
    .join("\n      ");

  const porEstado = { corrigido: 0, mitigado: 0, pendente: 0 };
  for (const s of Object.values(statusPorAchado)) porEstado[s.estado] += 1;

  return `<section class="page-break">
    <h2>Resumo executivo</h2>
    <p class="lead">A auditoria percorreu <strong>86 Server Actions</strong>, <strong>2 route handlers</strong>, todas as páginas do App Router, <strong>62 migrations</strong> e os arquivos de implantação. Somando a 2ª rodada de varredura ativa, foram <strong>${total} achados</strong>, nenhum crítico — e <strong>todos os ${total} foram endereçados</strong>: 14 corrigidos e verificados, 1 mitigado com resíduo aceito. Um teste de intrusão ativo, como invasor de menor privilégio, não abriu nenhuma brecha adicional.</p>

    <div class="cards">
      ${cards}
      <div class="card-sev" style="border-top-color:${COR_PONTO_FORTE}">
        <div class="card-num" style="color:${COR_PONTO_FORTE}">${pontosFortes.length}</div>
        <div class="card-lbl">Pontos fortes</div>
      </div>
    </div>

    <h3>Estado da remediação</h3>
    <div class="estado-barra">
      <div class="estado-card" style="border-left-color:${ESTADOS.corrigido.cor}">
        <span class="estado-num" style="color:${ESTADOS.corrigido.cor}">${porEstado.corrigido}</span>
        <span class="estado-lbl">Corrigidos e verificados</span>
      </div>
      <div class="estado-card" style="border-left-color:${ESTADOS.mitigado.cor}">
        <span class="estado-num" style="color:${ESTADOS.mitigado.cor}">${porEstado.mitigado}</span>
        <span class="estado-lbl">Mitigado (resíduo aceito)</span>
      </div>
      <div class="estado-card" style="border-left-color:${ESTADOS.pendente.cor}">
        <span class="estado-num" style="color:${ESTADOS.pendente.cor}">${porEstado.pendente}</span>
        <span class="estado-lbl">Pendentes</span>
      </div>
    </div>
    <p class="estado-nota">Todos os 15 achados foram endereçados — das duas altas às informativas. O único não “corrigido” é o F2, <strong>mitigado</strong>: o gate foi implementado e o resíduo de farm de XP dentro da Contabilidade foi aceito conscientemente.</p>

    <div class="graficos">
      <div class="grafico-box">
        <h3>Achados por severidade</h3>
        ${graficoRosca(contagens)}
      </div>
      <div class="grafico-box">
        <h3>Achados por categoria</h3>
        ${graficoBarras()}
      </div>
    </div>

    <h3>Veredito por categoria</h3>
    <table class="veredito">
      <thead><tr><th>Categoria</th><th>Achados</th><th>Veredito</th></tr></thead>
      <tbody>
        ${categorias
          .map(
            (c) => `<tr>
          <td class="cat-nome"><strong>${c.id}.</strong> ${esc(c.titulo)}</td>
          <td class="cat-num">${porCategoria[c.id] ?? 0}</td>
          <td>${rico(c.veredito)}</td>
        </tr>`,
          )
          .join("\n        ")}
      </tbody>
    </table>
  </section>`;
}

function secaoFortesFracos() {
  return `<section class="page-break">
    <h2>Pontos fortes — o que está protegido</h2>
    <p class="lead">Cada item abaixo foi verificado no código, não presumido. Esta seção também serve de prova de cobertura da auditoria.</p>
    <ol class="fortes">
      ${pontosFortes
        .map(
          (p) => `<li>
        <h4>${esc(p.titulo)}</h4>
        <p class="evidencia">${rico(p.evidencia)}</p>
      </li>`,
        )
        .join("\n      ")}
    </ol>

    <h2>Pontos fracos — os riscos centrais</h2>
    <p class="lead">Estes foram os riscos centrais no momento da auditoria (redigidos no presente para preservar o diagnóstico original). Todos os de severidade alta e média já foram <strong>corrigidos e verificados</strong> nesta revisão — o estado de cada um está no cartão do achado e na seção de validação ofensiva.</p>
    <ol class="fracos">
      ${pontosFracos.map((p) => `<li>${rico(p)}</li>`).join("\n      ")}
    </ol>
  </section>`;
}

function tabelaAchados() {
  const linhas = [...achados]
    .sort(
      (a, b) =>
        SEVERIDADES[a.severidade].ordem - SEVERIDADES[b.severidade].ordem ||
        a.categoria - b.categoria,
    )
    .map(
      (a) => `<tr>
      <td class="c-sev">${chip(a.severidade)}</td>
      <td class="c-est">${selo(a.id)}</td>
      <td class="c-arq"><code>${esc(a.arquivos[0])}</code>${
        a.arquivos.length > 1
          ? `<span class="mais">+${a.arquivos.length - 1} local${a.arquivos.length > 2 ? "is" : ""}</span>`
          : ""
      }</td>
      <td class="c-desc"><span class="c-id">${a.id}</span> ${esc(a.titulo)} <span class="c-cat">[cat. ${a.categoria}]</span></td>
    </tr>`,
    )
    .join("\n    ");

  return `<section class="page-break">
    <h2>Achados — visão consolidada</h2>
    <table class="achados-tabela">
      <thead><tr><th>Severidade</th><th>Estado</th><th>Arquivo:linha</th><th>Descrição</th></tr></thead>
      <tbody>
        ${linhas}
      </tbody>
    </table>
  </section>`;
}

/** Bloco de remediação renderizado no rodapé de cada cartão de achado. */
function blocoRemediacao(id) {
  const st = statusPorAchado[id];
  if (!st) return "";
  const cor = ESTADOS[st.estado].cor;
  return `<div class="remediacao" style="border-left-color:${cor}">
    <div class="rem-topo">${selo(id)} <span class="rem-titulo">Remediação</span></div>
    <p class="rem-linha"><strong>O que foi feito:</strong> ${rico(st.resumo)}</p>
    <p class="rem-linha"><strong>Verificação:</strong> ${rico(st.verificado)}</p>
  </div>`;
}

function detalhesPorCategoria() {
  return categorias
    .map((c) => {
      const daCategoria = achados
        .filter((a) => a.categoria === c.id)
        .sort(
          (a, b) => SEVERIDADES[a.severidade].ordem - SEVERIDADES[b.severidade].ordem,
        );

      const corpo =
        daCategoria.length === 0
          ? `<p class="sem-achado">Nenhum achado nesta categoria.</p>`
          : daCategoria
              .map(
                (a) => `<article class="achado">
          <header>
            ${chip(a.severidade)}
            ${selo(a.id)}
            <h3><span class="c-id">${a.id}</span> ${esc(a.titulo)}</h3>
          </header>
          <ul class="locais">
            ${a.arquivos.map((f) => `<li><code>${esc(f)}</code></li>`).join("\n            ")}
          </ul>
          <pre class="codigo">${esc(a.trecho)}</pre>
          <div class="bloco"><h5>Por que é explorável</h5><p>${rico(a.porque)}</p></div>
          <div class="bloco"><h5>Impacto</h5><p>${rico(a.impacto)}</p></div>
          <div class="bloco"><h5>Condições de exploração</h5><p>${rico(a.exploracao)}</p></div>
          ${blocoRemediacao(a.id)}
        </article>`,
              )
              .join("\n        ");

      return `<section class="page-break">
      <h2><span class="cat-badge">Categoria ${c.id}</span> ${esc(c.titulo)}</h2>
      <p class="veredito-cat">${rico(c.veredito)}</p>
      ${corpo}
    </section>`;
    })
    .join("\n  ");
}

function secaoPentest() {
  const badge = (r) => {
    const cor =
      r === "DERROTADO" || r === "BLOQUEADO" || r === "LIMPO"
        ? COR_PONTO_FORTE
        : "#B91C1C";
    return `<span class="pt-resultado" style="background:${cor}">${esc(r)}</span>`;
  };
  return `<section class="page-break">
    <h2>Validação ofensiva — teste de intrusão</h2>
    <p class="lead">${rico(pentest.resumo)}</p>
    ${pentest.classes
      .map(
        (c) => `<article class="pt-classe">
      <header class="pt-head">
        <h3>${esc(c.nome)}</h3>
        ${badge(c.resultado)}
      </header>
      <p class="pt-linha"><strong>Método:</strong> ${rico(c.metodo)}</p>
      <p class="pt-linha"><strong>Evidência:</strong> ${rico(c.evidencia)}</p>
    </article>`,
      )
      .join("\n    ")}
    <p class="pt-nota">${rico(pentest.nota_infra)}</p>

    <div class="correcao">
      <h3>${esc(correcaoF4.titulo)}</h3>
      <p>${rico(correcaoF4.corpo)}</p>
    </div>
  </section>`;
}

function secaoRecomendacoes() {
  return `<section class="page-break">
    <h2>Recomendações priorizadas</h2>
    <p class="lead">Registradas na 1ª rodada como plano de ação. Nesta revisão <strong>todas — P1, P2 e P3 — foram executadas e verificadas</strong> (ver o estado de cada achado). Ficam aqui como registro do que foi feito e em que ordem.</p>
    ${recomendacoes
      .map(
        (r) => `<div class="prio">
      <h3><span class="prio-badge">${r.prioridade}</span> ${esc(r.prazo)}</h3>
      <ol>
        ${r.itens
          .map(
            (i) => `<li>${rico(i.acao)} <span class="cobre">cobre ${esc(i.cobre)}</span></li>`,
          )
          .join("\n        ")}
      </ol>
    </div>`,
      )
      .join("\n    ")}
  </section>`;
}

function secaoIssues() {
  // Resolvida = nenhum achado coberto está PENDENTE (corrigido ou mitigado
  // contam como endereçado; o resíduo do mitigado fica explícito no cartão).
  const resolvida = (i) =>
    i.cobre.every((id) => statusPorAchado[id]?.estado !== "pendente");
  return `<section class="page-break">
    <h2>Issues para o GitHub</h2>
    <p class="lead">Texto completo, em Markdown, pronto para copiar e colar. Achados relacionados foram agrupados numa issue só quando a correção é a mesma. As marcadas <strong>Resolvida</strong> já foram corrigidas e verificadas nesta revisão — ficam aqui como registro; as demais seguem acionáveis.</p>
    ${issues
      .map(
        (i) => `<div class="issue">
      <div class="issue-meta">
        <span class="issue-num">Issue ${i.numero}</span>
        ${resolvida(i)
          ? `<span class="selo" style="color:${ESTADOS.corrigido.cor};border-color:${ESTADOS.corrigido.cor}">Resolvida</span>`
          : `<span class="selo" style="color:${ESTADOS.pendente.cor};border-color:${ESTADOS.pendente.cor}">Aberta</span>`}
        <span class="issue-labels">${i.labels.map((l) => `<code>${esc(l)}</code>`).join(" ")}</span>
        <span class="issue-cobre">achados: ${i.cobre.join(", ")}</span>
      </div>
      <pre class="markdown">--- ISSUE ${i.numero} ---

# ${esc(i.titulo)}

**Labels:** ${esc(i.labels.join(", "))}

${esc(i.corpo)}

--- FIM ISSUE ${i.numero} ---</pre>
    </div>`,
      )
      .join("\n    ")}
  </section>`;
}

// ── documento ───────────────────────────────────────────────────────────────

const CSS = `
  * { box-sizing: border-box; }
  html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body {
    margin: 0;
    font-family: "Segoe UI", "Helvetica Neue", Arial, sans-serif;
    font-size: 9.6pt;
    line-height: 1.55;
    color: #1e293b;
    background: #fff;
  }
  code {
    font-family: "Cascadia Mono", Consolas, "SF Mono", Menlo, monospace;
    font-size: 0.88em;
    background: #f1f5f9;
    border: 1px solid #e2e8f0;
    border-radius: 3px;
    padding: 0.5px 3px;
    word-break: break-word;
  }
  h1, h2, h3, h4, h5 { margin: 0 0 .45em; line-height: 1.25; }
  h2 {
    font-size: 16pt;
    color: #0f172a;
    border-bottom: 2px solid #0f172a;
    padding-bottom: 6px;
    margin-top: 0;
    margin-bottom: 14px;
  }
  h3 { font-size: 11.5pt; color: #0f172a; margin-top: 18px; }
  h4 { font-size: 10.2pt; color: #0f172a; }
  h5 {
    font-size: 7.6pt; text-transform: uppercase; letter-spacing: .09em;
    color: #64748b; margin-bottom: 3px;
  }
  p { margin: 0 0 .6em; orphans: 3; widows: 3; }
  section { break-before: auto; }
  .page-break { break-before: page; }

  /* capa */
  .capa { padding-top: 4mm; }
  .capa-marca {
    font-size: 8pt; text-transform: uppercase; letter-spacing: .22em;
    color: #64748b; margin-bottom: 10px;
  }
  .capa-titulo {
    font-size: 24pt; line-height: 1.08; color: #0f172a; font-weight: 700;
    margin-bottom: 6px;
  }
  .capa-titulo span { color: #B91C1C; }
  .capa-data { color: #475569; font-size: 8.8pt; margin-bottom: 16px; }
  .capa-h2 {
    font-size: 10.4pt; text-transform: uppercase; letter-spacing: .09em;
    color: #0f172a; border-bottom: 1px solid #cbd5e1; padding-bottom: 3px;
    margin-top: 15px; margin-bottom: 7px;
  }
  .capa-lista { margin: 0; padding-left: 17px; font-size: 8.9pt; }
  .capa-lista li { margin-bottom: 3px; }
  table.stack { width: 100%; border-collapse: collapse; }
  table.stack { font-size: 8.9pt; }
  table.stack th {
    text-align: left; vertical-align: top; width: 30%;
    padding: 4px 10px 4px 0; color: #0f172a; font-weight: 600;
    border-bottom: 1px solid #e2e8f0;
  }
  table.stack td {
    vertical-align: top; padding: 4px 0; border-bottom: 1px solid #e2e8f0;
  }
  .metodo { margin-bottom: 7px; break-inside: avoid; }
  .metodo h3 {
    font-size: 9pt; margin: 0 0 1px; color: #0f172a;
  }
  .metodo p { margin: 0; color: #334155; font-size: 8.5pt; line-height: 1.45; }
  .capa-rodape {
    margin-top: 14px; padding: 8px 11px; background: #f8fafc;
    border-left: 3px solid ${COR_PONTO_FORTE}; font-size: 8.5pt; color: #334155;
  }

  /* resumo */
  .lead { font-size: 10pt; color: #334155; margin-bottom: 14px; }
  .cards { display: flex; gap: 8px; margin: 14px 0 20px; }
  .card-sev {
    flex: 1; border: 1px solid #e2e8f0; border-top-width: 4px;
    border-radius: 4px; padding: 9px 6px; text-align: center; background: #fff;
  }
  .card-num { font-size: 20pt; font-weight: 700; line-height: 1; }
  .card-lbl {
    font-size: 7.4pt; text-transform: uppercase; letter-spacing: .07em;
    color: #64748b; margin-top: 3px;
  }
  .graficos { display: flex; gap: 18px; align-items: flex-start; margin-bottom: 6px; }
  .grafico-box {
    flex: 1; border: 1px solid #e2e8f0; border-radius: 4px; padding: 10px 12px;
    break-inside: avoid;
  }
  .grafico-box h3 {
    margin: 0 0 6px; font-size: 8.6pt; text-transform: uppercase;
    letter-spacing: .07em; color: #64748b;
  }
  .grafico { display: flex; align-items: center; gap: 10px; }
  .rosca-num { font-size: 26px; font-weight: 700; fill: #0f172a; }
  .rosca-txt { font-size: 9px; fill: #64748b; letter-spacing: .5px; }
  .legenda { list-style: none; margin: 0; padding: 0; font-size: 8.6pt; }
  .legenda li { display: flex; align-items: center; gap: 6px; margin-bottom: 4px; }
  .ponto { width: 9px; height: 9px; border-radius: 2px; display: inline-block; }
  .leg-rotulo { color: #334155; min-width: 62px; }
  .leg-valor { font-weight: 700; color: #0f172a; }
  .barra-rotulo { font-size: 9.5px; fill: #334155; font-family: inherit; }
  .barra-valor { font-size: 10px; fill: #0f172a; font-weight: 700; font-family: inherit; }

  table.veredito { width: 100%; border-collapse: collapse; font-size: 8.9pt; }
  table.veredito th {
    text-align: left; background: #0f172a; color: #fff; padding: 6px 8px;
    font-size: 7.8pt; text-transform: uppercase; letter-spacing: .07em;
  }
  table.veredito td {
    padding: 7px 8px; border-bottom: 1px solid #e2e8f0; vertical-align: top;
  }
  table.veredito tr { break-inside: avoid; }
  .cat-nome { width: 27%; }
  .cat-num { width: 7%; text-align: center; font-weight: 700; font-size: 11pt; color: #0f172a; }

  /* fortes / fracos */
  ol.fortes { margin: 0 0 22px; padding-left: 20px; }
  ol.fortes li { margin-bottom: 9px; break-inside: avoid; }
  ol.fortes h4 { margin: 0 0 2px; }
  .evidencia { margin: 0; color: #334155; font-size: 8.9pt; }
  ol.fracos { margin: 0; padding-left: 20px; }
  ol.fracos li {
    margin-bottom: 8px; break-inside: avoid; color: #334155;
  }

  /* chips e tabela de achados */
  .chip {
    display: inline-block; color: #fff; font-size: 7.2pt; font-weight: 700;
    text-transform: uppercase; letter-spacing: .06em; padding: 2px 7px;
    border-radius: 9px; white-space: nowrap;
  }
  table.achados-tabela { width: 100%; border-collapse: collapse; font-size: 8.7pt; }
  table.achados-tabela th {
    text-align: left; background: #0f172a; color: #fff; padding: 6px 8px;
    font-size: 7.8pt; text-transform: uppercase; letter-spacing: .07em;
  }
  table.achados-tabela td {
    padding: 7px 8px; border-bottom: 1px solid #e2e8f0; vertical-align: top;
  }
  table.achados-tabela tr { break-inside: avoid; }
  .c-sev { width: 15%; }
  .c-arq { width: 40%; }
  .c-arq code { font-size: 7.7pt; }
  .mais {
    display: block; font-size: 7.4pt; color: #64748b; margin-top: 2px;
  }
  .c-id {
    display: inline-block; background: #0f172a; color: #fff; font-weight: 700;
    font-size: 7.4pt; padding: 1px 5px; border-radius: 3px; margin-right: 4px;
  }
  .c-cat { color: #94a3b8; font-size: 7.8pt; white-space: nowrap; }

  /* achados detalhados */
  .cat-badge {
    display: inline-block; background: #0f172a; color: #fff; font-size: 8pt;
    padding: 2px 8px; border-radius: 3px; vertical-align: middle;
    margin-right: 6px; letter-spacing: .04em;
  }
  .veredito-cat {
    background: #f8fafc; border-left: 3px solid #0f172a; padding: 8px 11px;
    margin-bottom: 16px; color: #334155; font-size: 9.2pt;
  }
  .sem-achado {
    background: #ecfdf5; border-left: 3px solid ${COR_PONTO_FORTE};
    padding: 9px 12px; color: #065f46; font-weight: 600;
  }
  /* Sem break-inside:avoid no cartão inteiro — alguns passam de uma página e o
     Chromium responderia empurrando tudo, deixando meia folha em branco. O que
     não pode quebrar é o trecho de código e cada bloco de análise. */
  .achado {
    border: 1px solid #e2e8f0; border-radius: 4px; padding: 12px 14px;
    margin-bottom: 14px;
  }
  .achado header {
    display: flex; align-items: baseline; gap: 8px; margin-bottom: 7px;
    break-after: avoid;
  }
  .achado header h3 { margin: 0; font-size: 11pt; }
  ul.locais { list-style: none; margin: 0 0 9px; padding: 0; break-inside: avoid; }
  ul.locais li { margin-bottom: 2px; }
  ul.locais code { font-size: 7.8pt; background: #fff7ed; border-color: #fed7aa; }
  pre.codigo {
    background: #0f172a; color: #e2e8f0; padding: 10px 12px; border-radius: 4px;
    font-family: "Cascadia Mono", Consolas, "SF Mono", Menlo, monospace;
    font-size: 7.5pt; line-height: 1.45; margin: 0 0 10px;
    white-space: pre-wrap; word-break: break-word; overflow-wrap: anywhere;
    break-inside: avoid;
  }
  .bloco { margin-bottom: 8px; break-inside: avoid; }
  .bloco p { margin: 0; color: #334155; font-size: 9pt; }
  .nota-grafico {
    margin: 6px 0 0; font-size: 7.4pt; color: #94a3b8;
  }

  /* recomendações */
  .prio { margin-bottom: 16px; break-inside: avoid; }
  .prio h3 { display: flex; align-items: center; gap: 8px; font-size: 10.4pt; }
  .prio-badge {
    background: #B91C1C; color: #fff; font-size: 8.4pt; font-weight: 700;
    padding: 2px 9px; border-radius: 3px;
  }
  .prio:nth-of-type(2) .prio-badge { background: #D97706; }
  .prio:nth-of-type(3) .prio-badge { background: #2563EB; }
  .prio ol { margin: 4px 0 0; padding-left: 20px; }
  .prio li { margin-bottom: 7px; color: #334155; }
  .cobre {
    display: inline-block; background: #f1f5f9; border: 1px solid #e2e8f0;
    border-radius: 9px; padding: 0 7px; font-size: 7.4pt; color: #64748b;
    white-space: nowrap;
  }

  /* issues */
  .issue { margin-bottom: 18px; }
  .issue-meta {
    display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
    margin-bottom: 5px; break-after: avoid;
  }
  .issue-num {
    background: #0f172a; color: #fff; font-weight: 700; font-size: 8.4pt;
    padding: 2px 9px; border-radius: 3px;
  }
  .issue-labels code { font-size: 7.6pt; }
  .issue-cobre { font-size: 7.8pt; color: #64748b; }
  pre.markdown {
    background: #f8fafc; border: 1px solid #cbd5e1; border-left: 3px solid #B91C1C;
    padding: 11px 13px; border-radius: 3px;
    font-family: "Cascadia Mono", Consolas, "SF Mono", Menlo, monospace;
    font-size: 7.4pt; line-height: 1.5; margin: 0;
    white-space: pre-wrap; word-break: break-word; overflow-wrap: anywhere;
    color: #1e293b;
  }

  /* revisão 2 — capa */
  .capa-rev {
    margin: 12px 0 4px; padding: 9px 12px; background: #ecfdf5;
    border-left: 3px solid ${COR_PONTO_FORTE}; font-size: 8.8pt; color: #065f46;
  }

  /* selo de estado de remediação */
  .selo {
    display: inline-block; border: 1.4px solid; border-radius: 9px;
    padding: 0 7px; font-size: 7pt; font-weight: 700; text-transform: uppercase;
    letter-spacing: .05em; white-space: nowrap; background: #fff;
  }

  /* barra de estado no resumo */
  .estado-barra { display: flex; gap: 8px; margin: 8px 0 6px; }
  .estado-card {
    flex: 1; border: 1px solid #e2e8f0; border-left-width: 4px;
    border-radius: 4px; padding: 8px 10px; background: #fff;
  }
  .estado-num { font-size: 17pt; font-weight: 700; line-height: 1; display: block; }
  .estado-lbl { font-size: 8pt; color: #64748b; }
  .estado-nota { font-size: 8.6pt; color: #334155; margin-top: 2px; }

  /* coluna de estado na tabela consolidada */
  .c-est { width: 12%; white-space: nowrap; }

  /* bloco de remediação no cartão de achado */
  .remediacao {
    margin-top: 10px; padding: 9px 11px; background: #f8fafc;
    border-left: 3px solid; border-radius: 0 3px 3px 0; break-inside: avoid;
  }
  .rem-topo { display: flex; align-items: center; gap: 7px; margin-bottom: 4px; }
  .rem-titulo {
    font-size: 7.6pt; text-transform: uppercase; letter-spacing: .09em;
    color: #64748b; font-weight: 700;
  }
  .rem-linha { margin: 0 0 3px; font-size: 8.7pt; color: #334155; }

  /* seção de pentest */
  .pt-classe {
    border: 1px solid #e2e8f0; border-radius: 4px; padding: 10px 13px;
    margin-bottom: 10px; break-inside: avoid;
  }
  .pt-head {
    display: flex; align-items: center; justify-content: space-between;
    gap: 8px; margin-bottom: 5px;
  }
  .pt-head h3 { margin: 0; font-size: 10.4pt; }
  .pt-resultado {
    color: #fff; font-size: 7.4pt; font-weight: 700; text-transform: uppercase;
    letter-spacing: .06em; padding: 2px 8px; border-radius: 9px; white-space: nowrap;
  }
  .pt-linha { margin: 0 0 4px; font-size: 8.8pt; color: #334155; }
  .pt-nota {
    margin-top: 10px; padding: 8px 11px; background: #f8fafc;
    border-left: 3px solid #94a3b8; font-size: 8.4pt; color: #475569;
  }
  .correcao {
    margin-top: 14px; padding: 10px 13px; background: #fff7ed;
    border: 1px solid #fed7aa; border-left: 3px solid #EA580C; border-radius: 0 3px 3px 0;
    break-inside: avoid;
  }
  .correcao h3 { margin: 0 0 4px; font-size: 10pt; color: #9a3412; }
  .correcao p { margin: 0; font-size: 8.8pt; color: #7c2d12; }
`;

function documento() {
  const contagens = {};
  for (const a of achados) contagens[a.severidade] = (contagens[a.severidade] ?? 0) + 1;

  const porCategoria = {};
  for (const a of achados) porCategoria[a.categoria] = (porCategoria[a.categoria] ?? 0) + 1;

  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <title>Relatório de Auditoria de Segurança — ${esc(meta.projeto)}</title>
  <style>${CSS}</style>
</head>
<body>
  ${capa()}
  ${resumoExecutivo(contagens, porCategoria)}
  ${secaoFortesFracos()}
  ${tabelaAchados()}
  ${detalhesPorCategoria()}
  ${secaoPentest()}
  ${secaoRecomendacoes()}
  ${secaoIssues()}
</body>
</html>`;
}

// ── execução ────────────────────────────────────────────────────────────────

const estilo = "font-size:7pt;font-family:Arial,sans-serif;color:#94a3b8;width:100%;padding:0 20mm;";

async function main() {
  await mkdir(AQUI, { recursive: true });
  const html = documento();
  await writeFile(SAIDA_HTML, html, "utf8");

  const navegador = await chromium.launch();
  const pagina = await navegador.newPage();
  await pagina.setContent(html, { waitUntil: "networkidle" });

  await pagina.pdf({
    path: SAIDA_PDF,
    format: "A4",
    printBackground: true,
    displayHeaderFooter: true,
    margin: { top: "20mm", bottom: "18mm", left: "20mm", right: "20mm" },
    headerTemplate: `<div style="${estilo}display:flex;justify-content:space-between;">
      <span>Relatório de Auditoria de Segurança — ${esc(meta.projeto)}</span>
      <span>${esc(meta.data)}</span>
    </div>`,
    footerTemplate: `<div style="${estilo}display:flex;justify-content:space-between;">
      <span>Confidencial — uso interno</span>
      <span>Página <span class="pageNumber"></span> de <span class="totalPages"></span></span>
    </div>`,
  });

  await navegador.close();

  const porSeveridade = {};
  for (const a of achados) porSeveridade[a.severidade] = (porSeveridade[a.severidade] ?? 0) + 1;

  console.log(`HTML: ${SAIDA_HTML}`);
  console.log(`PDF : ${SAIDA_PDF}`);
  console.log(
    `${achados.length} achados — ` +
      Object.entries(SEVERIDADES)
        .sort((a, b) => a[1].ordem - b[1].ordem)
        .map(([k, v]) => `${v.rotulo}: ${porSeveridade[k] ?? 0}`)
        .join(", "),
  );
  const porEstado = { corrigido: 0, mitigado: 0, pendente: 0 };
  for (const s of Object.values(statusPorAchado)) porEstado[s.estado] += 1;
  console.log(
    `estado — corrigido: ${porEstado.corrigido}, mitigado: ${porEstado.mitigado}, pendente: ${porEstado.pendente}`,
  );
  console.log(
    `${pontosFortes.length} pontos fortes, ${pentest.classes.length} classes de pentest, ${issues.length} issues.`,
  );
}

await main();
