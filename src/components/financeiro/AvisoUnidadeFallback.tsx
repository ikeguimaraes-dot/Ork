// Aviso discreto pra quando não há cookie de unidade do shell ainda — a
// tela cai pra primeira unidade ativa em vez de travar. Compartilhado por
// todas as telas que pararam de ter seletor de unidade próprio (a unidade
// é contexto global, definido no seletor do shell).
export function AvisoUnidadeFallback({ cookiePresente }: { cookiePresente: boolean }) {
  if (cookiePresente) return null
  return (
    <p style={{ fontSize: 11, color: "var(--color-warning)", margin: "0 0 10px" }}>
      Exibindo a primeira unidade disponível. Use o menu para escolher outra unidade.
    </p>
  )
}
