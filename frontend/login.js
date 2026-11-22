const form = document.querySelector("form");
document.documentElement.classList.toggle('pwa-standalone',
  window.matchMedia('(display-mode: standalone)').matches || !!navigator.standalone);
const button = form.querySelector("button");
const error = document.getElementById("error");
const query = new URLSearchParams(location.search);
const changePassword = query.get("cambiar") === "1";
const link = form.querySelector(".account-link");
const supportsAccounts = document.documentElement.dataset.accounts === "true";
if (query.get("salida") === "local") {
  document.querySelector("main > p").textContent = "Saliste de este dispositivo. Supabase no pudo confirmar el cierre de la sesión remota.";
}
link.hidden = !supportsAccounts;
if (changePassword && supportsAccounts) {
  document.querySelector("h1").textContent = "Cambiar contraseña";
  document.querySelector("main > p").textContent = "Introduce tu contraseña actual y elige una nueva de al menos 6 caracteres, sin combinaciones obligatorias.";
  const input = form.elements.newPassword;
  input.closest("label").hidden = false;
  input.disabled = false;
  input.required = true;
  button.textContent = "Guardar contraseña y entrar";
  link.href = "/login";
  link.textContent = "Volver al inicio de sesión";
}
const change = changePassword && supportsAccounts;
const buttonLabel = button.textContent;
form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (button.disabled) return;
  button.disabled = true;
  button.textContent = window.__FELIX_DESKTOP__ ? "Preparando el equipo…" : "Verificando…";
  error.hidden = true;
  try {
    const response = await fetch(change ? "/cuenta/clave" : "/login", {
      method: "POST",
      credentials: "same-origin",
      mode: "same-origin",
      redirect: "error",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(window.__FELIX_DESKTOP__ ? 120000 : 15000),
      body: JSON.stringify({
        username: form.elements.username.value,
        password: form.elements.password.value,
        remember: form.elements.remember.checked,
        next: query.get("next"),
        ...(change && { newPassword: form.elements.newPassword.value }),
      }),
    });
    const result = await response.json();
    if (response.status !== 200)
      throw new Error(result.error || "No se pudo iniciar sesión.");
    location.replace(result.redirect);
  } catch (cause) {
    error.textContent =
      cause instanceof TypeError ||
      cause instanceof SyntaxError ||
      cause.name === "TimeoutError"
        ? "No se pudo conectar con el sistema. Inténtalo de nuevo."
        : cause.message;
    error.hidden = false;
    button.disabled = false;
    button.textContent = buttonLabel;
  }
});
