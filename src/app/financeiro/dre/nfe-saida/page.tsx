import { NfeProdutosPage, type NfeSearchParams } from "../cmv/page"

export const dynamic = "force-dynamic"

export default function NfeSaidaPage({ searchParams }: { searchParams: NfeSearchParams }) {
  return <NfeProdutosPage searchParams={searchParams} direcao="saida" />
}
