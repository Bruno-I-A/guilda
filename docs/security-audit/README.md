# Auditoria de segurança — Guilda

Relatório de auditoria de segurança + remediação + teste de intrusão.

- **Auditoria**: 2026-08-28 (branch `design-system`)
- **Revisão 2 (pós-remediação)**: 2026-08-29

| Arquivo | O que é |
| --- | --- |
| `relatorio-auditoria-seguranca.pdf` | O relatório (33 páginas, A4). **Entregável.** |
| `dados.mjs` | Achados originais (F1–F15), pontos fortes/fracos, recomendações, issues. |
| `dados-rev2.mjs` | Estado de remediação por achado, correção do F4, dados do pentest. |
| `gerar-relatorio.mjs` | Monta o HTML (gráficos em SVG puro) e imprime o PDF. |
| `verificar-pdf.mjs` | Confere o PDF: tamanho e número de páginas. |
| `relatorio-auditoria-seguranca.html` | Saída intermediária, útil para inspeção no navegador. |

## Regerar

```bash
node docs/security-audit/gerar-relatorio.mjs && node docs/security-audit/verificar-pdf.mjs
```

Usa o Chromium da devDependency `playwright`; não instala nada.

## Estado

15 achados: 0 crítica, 2 alta, 5 média, 3 baixa, 5 informativa.
Remediação: **14 corrigidos e verificados, 1 mitigado (resíduo de farm de XP aceito)**,
0 pendentes — de ponta a ponta, das duas altas às informativas.

Um teste de intrusão ativo (invasor de menor privilégio contra tenant-vítima real)
não abriu nenhuma brecha adicional — 5 classes de ataque contidas.
