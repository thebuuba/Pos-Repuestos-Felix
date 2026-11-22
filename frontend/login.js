const form = document.querySelector("form");
const button = form.querySelector("button");
const error = document.getElementById("error");
form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (button.disabled) return;
  button.disabled = true;
  button.textContent = "Verificando…";
  error.hidden = true;
  try {
    const response = await fetch("/login", {
      method: "POST",
      credentials: "same-origin",
      mode: "same-origin",
      redirect: "error",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(15000),
      body: JSON.stringify({
        username: form.elements.username.value,
        password: form.elements.password.value,
        remember: form.elements.remember.checked,
        next: new URLSearchParams(location.search).get("next"),
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
    button.textContent = "Entrar al sistema";
  }
});
