"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  criarRegraClassificacao,
  gerarRazao,
  removerRegra,
  type FornecedorNaoClassificado,
  type PlanoContaOpcao,
  type RegraClassificacao,
} from "@/app/financeiro/razao/actions";
import { formatBRL } from "@/lib/financeiro/utils";

type Props = {
  unitId: string;
  competencia: string;
  totalNaoClassificado: number;
  fornecedores: FornecedorNaoClassificado[];
  planoContas: PlanoContaOpcao[];
  regrasIniciais: RegraClassificacao[];
};

const GRUPO_LABEL: Record<string, string> = {
  receita: "Receita",
  deducao: "Deduções",
  cmv: "CMV",
  mao_de_obra: "Mão de obra",
  despesa_operacional: "Despesas operacionais",
  financeiro: "Financeiro",
  investimento: "Investimento",
};

function chaveFornecedor(f: FornecedorNaoClassificado): string {
  return f.fornecedorCnpj || f.fornecedorNome || "—";
}

export function ClassificacaoPainel({ unitId, competencia, totalNaoClassificado, fornecedores, planoContas, regrasIniciais }: Props) {
  const router = useRouter();
  const [contaEscolhida, setContaEscolhida] = useState<Record<string, string>>({});
  const [processando, setProcessando] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [regras, setRegras] = useState(regrasIniciais);

  const planoContasPorGrupo = new Map<string, PlanoContaOpcao[]>();
  for (const p of planoContas) {
    const lista = planoContasPorGrupo.get(p.grupo) ?? [];
    lista.push(p);
    planoContasPorGrupo.set(p.grupo, lista);
  }

  async function classificar(f: FornecedorNaoClassificado) {
    const chave = chaveFornecedor(f);
    const contaCodigo = contaEscolhida[chave];
    if (!contaCodigo) { setErro("Escolha uma conta antes de classificar."); return; }

    setProcessando(chave);
    setErro(null);
    try {
      const tipo = f.fornecedorCnpj ? "fornecedor_cnpj" : "fornecedor_nome";
      const padrao = f.fornecedorCnpj ?? f.fornecedorNome ?? "";
      if (!padrao) { setErro("Fornecedor sem nome nem CNPJ — não é possível criar regra."); return; }

      const regra = await criarRegraClassificacao(unitId, tipo, padrao, contaCodigo);
      if (!regra.ok) { setErro(regra.error ?? "Falha ao criar regra."); return; }

      const razao = await gerarRazao(unitId, competencia);
      if (!razao.ok) { setErro("Regra criada, mas gerarRazao() falhou ao reprocessar — recarregue e confira."); }

      router.refresh();
    } finally {
      setProcessando(null);
    }
  }

  async function remover(id: string) {
    setProcessando(id);
    setErro(null);
    try {
      const resultado = await removerRegra(id);
      if (!resultado.ok) { setErro(resultado.error ?? "Falha ao remover regra."); return; }
      setRegras((prev) => prev.filter((r) => r.id !== id));
      router.refresh();
    } finally {
      setProcessando(null);
    }
  }

  return (
    <div style={{ display: "grid", gap: 20 }}>
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
        <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: "14px 18px" }}>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.6, textTransform: "uppercase", color: "var(--text-3)" }}>Total em 9.99</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: "var(--text)", marginTop: 4 }}>{formatBRL(totalNaoClassificado)}</div>
        </div>
        <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: "14px 18px" }}>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.6, textTransform: "uppercase", color: "var(--text-3)" }}>Fornecedores faltando</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: "var(--text)", marginTop: 4 }}>{fornecedores.length}</div>
        </div>
      </div>

      {erro && (
        <div style={{ padding: "9px 14px", borderRadius: 8, background: "rgba(239,68,68,.1)", color: "#ef4444", fontSize: 13 }}>{erro}</div>
      )}

      <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden" }}>
        <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)" }}>
          <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.6, textTransform: "uppercase", color: "var(--text-3)" }}>
            A classificar
          </span>
        </div>
        {fornecedores.length === 0 ? (
          <p style={{ padding: 24, textAlign: "center", color: "var(--text-3)", fontSize: 13 }}>
            Nada a classificar nessa competência — tudo em 9.99 já tem regra.
          </p>
        ) : (
          <div>
            {fornecedores.map((f) => {
              const chave = chaveFornecedor(f);
              return (
                <div key={chave} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "12px 16px", borderBottom: "1px solid var(--border)", flexWrap: "wrap" }}>
                  <div style={{ minWidth: 220 }}>
                    <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: "var(--text)" }}>{f.fornecedorNome ?? f.fornecedorCnpj ?? "Sem nome"}</p>
                    <p style={{ margin: "2px 0 0", fontSize: 11, color: "var(--text-3)" }}>
                      {f.fornecedorCnpj ? `CNPJ ${f.fornecedorCnpj} · ` : ""}{f.quantidade} lançamento{f.quantidade !== 1 ? "s" : ""}
                    </p>
                  </div>
                  <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text)", minWidth: 110, textAlign: "right" }}>
                    {formatBRL(f.valorTotal)}
                  </div>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <select
                      value={contaEscolhida[chave] ?? ""}
                      onChange={(e) => setContaEscolhida((prev) => ({ ...prev, [chave]: e.target.value }))}
                      style={{ padding: "7px 10px", borderRadius: 8, fontSize: 13, background: "var(--surface-2)", color: "var(--text)", border: "1px solid var(--border)", minWidth: 220 }}
                    >
                      <option value="">— escolher conta —</option>
                      {[...planoContasPorGrupo.entries()].map(([grupo, contas]) => (
                        <optgroup key={grupo} label={GRUPO_LABEL[grupo] ?? grupo}>
                          {contas.map((c) => (
                            <option key={c.codigo} value={c.codigo}>{c.codigo} — {c.nome}</option>
                          ))}
                        </optgroup>
                      ))}
                    </select>
                    <button
                      onClick={() => void classificar(f)}
                      disabled={processando === chave || !contaEscolhida[chave]}
                      style={{
                        padding: "7px 14px", borderRadius: 8, fontSize: 12, fontWeight: 700, border: 0, cursor: "pointer",
                        background: contaEscolhida[chave] ? "var(--brand, #C4622D)" : "var(--surface-2)",
                        color: contaEscolhida[chave] ? "white" : "var(--text-3)",
                      }}
                    >
                      {processando === chave ? "Classificando…" : "Classificar"}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden" }}>
        <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)" }}>
          <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.6, textTransform: "uppercase", color: "var(--text-3)" }}>
            Regras ativas
          </span>
        </div>
        {regras.length === 0 ? (
          <p style={{ padding: 24, textAlign: "center", color: "var(--text-3)", fontSize: 13 }}>Nenhuma regra criada ainda.</p>
        ) : (
          <div>
            {regras.map((r) => (
              <div key={r.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "10px 16px", borderBottom: "1px solid var(--border)", fontSize: 13 }}>
                <div>
                  <span style={{ color: "var(--text)", fontWeight: 600 }}>{r.padrao}</span>
                  <span style={{ color: "var(--text-3)" }}> · {r.tipo === "fornecedor_cnpj" ? "por CNPJ" : "por nome"} · {r.unitId ? "só esta unidade" : "todas as unidades"}</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <span style={{ color: "var(--text-2)" }}>→ {r.contaCodigo}</span>
                  <button
                    onClick={() => void remover(r.id)}
                    disabled={processando === r.id}
                    style={{ padding: "5px 10px", borderRadius: 6, fontSize: 11, fontWeight: 700, border: "1px solid var(--border)", background: "transparent", color: "#ef4444", cursor: "pointer" }}
                  >
                    {processando === r.id ? "Removendo…" : "Remover"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
