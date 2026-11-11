export type CorCertificado = "verde" | "amarelo" | "vermelho";

export interface StatusCertificado {
  cor: CorCertificado;
  texto: string;
}

export const DIAS_AVISO_VENCIMENTO = 30;

/** Semáforo do certificado A1 de uma loja: verde = válido, amarelo = vence em
 *  até 30 dias, vermelho = vencido, com senha errada ou sem certificado. */
export function statusCertificado(
  cert: { status: string; validUntil: Date | string | null } | null | undefined,
  agora: Date = new Date()
): StatusCertificado {
  if (!cert) return { cor: "vermelho", texto: "Sem certificado" };
  if (cert.status === "PASSWORD_ERROR") return { cor: "vermelho", texto: "Senha incorreta — reenvie" };
  if (!cert.validUntil) return { cor: "amarelo", texto: "Validade desconhecida" };
  const validade = new Date(cert.validUntil);
  const dias = Math.floor((validade.getTime() - agora.getTime()) / 86_400_000);
  const data = validade.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
  if (cert.status === "EXPIRED" || validade.getTime() < agora.getTime())
    return { cor: "vermelho", texto: `Vencido em ${data}` };
  if (dias <= DIAS_AVISO_VENCIMENTO)
    return { cor: "amarelo", texto: dias <= 0 ? `Vence hoje (${data})` : `Vence em ${dias} dia(s) (${data})` };
  return { cor: "verde", texto: `Válido até ${data}` };
}
