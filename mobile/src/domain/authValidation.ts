import type { TranslationKey } from '../i18n/translations.ts'

export type RegistrationField = 'fullName' | 'email' | 'phone' | 'businessName' | 'password' | 'confirmPassword'
export type LoginField = 'email' | 'password'

export interface AuthValidationIssue {
  field: RegistrationField | LoginField
  message: TranslationKey
}

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function validateOnlineLogin(email: string, password: string): AuthValidationIssue[] {
  const issues: AuthValidationIssue[] = []
  if (!email.trim()) issues.push({ field: 'email', message: 'errors.emailRequired' })
  else if (!emailPattern.test(email.trim())) issues.push({ field: 'email', message: 'errors.emailInvalid' })
  if (!password) issues.push({ field: 'password', message: 'errors.onlinePasswordRequired' })
  return issues
}

export function validateOnlineRegistration(input: {
  fullName: string
  email: string
  phone: string
  businessName: string
  password: string
  confirmPassword: string
}): AuthValidationIssue[] {
  const issues: AuthValidationIssue[] = []
  const fullName = input.fullName.trim()
  const businessName = input.businessName.trim()
  const email = input.email.trim()

  if (fullName.length < 2) issues.push({ field: 'fullName', message: 'errors.onlineFullName' })
  else if (fullName.length > 160) issues.push({ field: 'fullName', message: 'errors.nameMax' })

  if (!email) issues.push({ field: 'email', message: 'errors.emailRequired' })
  else if (!emailPattern.test(email)) issues.push({ field: 'email', message: 'errors.emailInvalid' })

  if (input.phone.trim().length > 32) issues.push({ field: 'phone', message: 'errors.phoneMax' })

  if (businessName.length < 2) issues.push({ field: 'businessName', message: 'errors.onlineBusinessName' })
  else if (businessName.length > 180) issues.push({ field: 'businessName', message: 'errors.businessMax' })

  if (input.password.length < 8) issues.push({ field: 'password', message: 'errors.onlinePasswordLength' })
  else if (input.password.length > 128) issues.push({ field: 'password', message: 'errors.passwordMax' })

  if (!input.confirmPassword) issues.push({ field: 'confirmPassword', message: 'errors.confirmPasswordRequired' })
  else if (input.password !== input.confirmPassword) {
    issues.push({ field: 'confirmPassword', message: 'errors.passwordMismatch' })
  }
  return issues
}

export function firstAuthIssue(
  issues: AuthValidationIssue[],
): Partial<Record<RegistrationField | LoginField, TranslationKey>> {
  const errors: Partial<Record<RegistrationField | LoginField, TranslationKey>> = {}
  for (const issue of issues) errors[issue.field] ??= issue.message
  return errors
}
