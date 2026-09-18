import type { ResultadoFluxo } from "@/lib/financeiro/fluxo/calcularFluxo"
import { CardsResumo } from "./CardsResumo"
import { FluxoCalendario } from "./FluxoCalendario"
import { APagarPorFaixa } from "./APagarPorFaixa"
import { AReceberPorForma } from "./AReceberPorForma"
import { ConfiancaIndex } from "./ConfiancaIndex"

type Props = {
  dados: ResultadoFluxo
  temContaCadastrada: boolean
}

export function FluxoPainel({ dados, temContaCadastrada }: Props) {
  return (
    <div>
      {dados.contaId && <p className="ork-panel">Esta visão considera o saldo e os movimentos da conta selecionada. Para ver previsões ainda sem conta bancária definida, selecione todas as contas.</p>}
      <CardsResumo resumo={dados.resumo} confianca={dados.confianca} temContaCadastrada={temContaCadastrada} />
      <FluxoCalendario dias={dados.dias} hoje={dados.hoje} diaCruzaZero={dados.resumo.diaCruzaZero} />
      <APagarPorFaixa aPagarPorFaixa={dados.aPagarPorFaixa} aPagarSemData={dados.aPagarSemData} />
      <AReceberPorForma
        aReceberPorForma={dados.aReceberPorForma}
        antecipacaoRegistrada={dados.antecipacaoRegistrada}
        ultimaReceitaImportada={dados.ultimaReceitaImportada}
      />
      <ConfiancaIndex confianca={dados.confianca} />
    </div>
  )
}
