/** Tradução das mensagens de erro mais comuns do better-auth. */
const MESSAGES: Record<string, string> = {
  USER_ALREADY_EXISTS: "Já existe uma conta com este e-mail.",
  INVALID_EMAIL_OR_PASSWORD: "E-mail ou senha incorretos.",
  PASSWORD_TOO_SHORT: "A senha precisa de pelo menos 8 caracteres.",
  PASSWORD_TOO_LONG: "A senha é longa demais.",
  INVALID_EMAIL: "E-mail inválido.",
  EMAIL_NOT_VERIFIED: "E-mail ainda não verificado.",
  ORGANIZATION_ALREADY_EXISTS: "Já existe uma organização com esse nome.",
  ORGANIZATION_NOT_FOUND: "Organização não encontrada.",
  INVITATION_NOT_FOUND: "Convite não encontrado ou já utilizado.",
  YOU_ARE_NOT_THE_RECIPIENT_OF_THE_INVITATION:
    "Este convite foi emitido para outro e-mail.",
  YOU_ARE_NOT_ALLOWED_TO_INVITE_USERS_TO_THIS_ORGANIZATION:
    "Você não tem permissão para convidar membros.",
  USER_IS_ALREADY_A_MEMBER_OF_THIS_ORGANIZATION:
    "Este usuário já é membro da organização.",
  USER_IS_ALREADY_INVITED_TO_THIS_ORGANIZATION:
    "Já existe um convite pendente para este e-mail.",
  RATE_LIMIT_EXCEEDED: "Muitas tentativas. Aguarde um pouco e tente de novo.",
};

export function authErrorMessage(error: {
  code?: string | undefined;
  message?: string | undefined;
}): string {
  if (error.code && MESSAGES[error.code]) {
    return MESSAGES[error.code];
  }
  return error.message ?? "Algo deu errado. Tente novamente.";
}
