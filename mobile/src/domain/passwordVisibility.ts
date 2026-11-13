export function passwordVisibilityState(visible: boolean) {
  return {
    secureTextEntry: !visible,
    accessibilityLabel: visible ? 'auth.hidePassword' as const : 'auth.showPassword' as const,
  }
}

export function togglePasswordVisibility(visible: boolean): boolean {
  return !visible
}
