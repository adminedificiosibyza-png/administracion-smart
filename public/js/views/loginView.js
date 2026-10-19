/* Pantalla de ingreso: usuario (nombre completo) + contraseña */
import { authService } from '../services/authService.js';

export function renderLogin(root, onSuccess) {
  root.innerHTML = `
    <div class="login-card">
      <div class="login-brand">
        <img src="assets/logo.svg" alt="Administracion Smart" class="login-logo">

        <h1>ADMINISTRACION <span>SMART</span></h1>
        <p>Portal de administración y propietarios</p>
      </div>

      <form id="login-form" novalidate>
        <div class="form-group">
          <label class="form-label" for="login-user">Usuario</label>
          <input type="text" id="login-user" class="form-control" autocomplete="username"
                 placeholder="Su nombre completo" autofocus required>
          <span class="login-hint">Escriba su nombre completo, como se lo entregó la administración.</span>
        </div>

        <div class="form-group">
          <label class="form-label" for="login-pass">Contraseña</label>
          <div class="login-pass-wrap">
            <input type="password" id="login-pass" class="form-control" autocomplete="current-password" required>
            <button type="button" class="btn-icon" id="login-toggle" aria-label="Mostrar u ocultar la contraseña">
              <i data-lucide="eye"></i>
            </button>
          </div>
        </div>

        <div id="login-error" class="form-error" role="alert" hidden></div>

        <button type="submit" class="btn btn-primary login-submit" id="login-submit">
          <i data-lucide="log-in"></i> Ingresar
        </button>
      </form>

      <p class="login-help">¿Olvidó su contraseña? Solicite una nueva a la administración.</p>
    </div>
  `;

  const $ = id => root.querySelector(id);
  const errorBox = $('#login-error');
  const showError = msg => { errorBox.textContent = msg || ''; errorBox.hidden = !msg; };

  $('#login-toggle').addEventListener('click', () => {
    const input = $('#login-pass');
    input.type = input.type === 'password' ? 'text' : 'password';
  });

  $('#login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    showError('');
    const submit = $('#login-submit');
    submit.disabled = true;
    submit.textContent = 'Ingresando...';
    try {
      await authService.signIn($('#login-user').value, $('#login-pass').value);
      onSuccess();
    } catch (err) {
      showError(err.message);
      submit.disabled = false;
      submit.innerHTML = '<i data-lucide="log-in"></i> Ingresar';
      $('#login-pass').value = '';
      $('#login-pass').focus();
      if (window.lucide) window.lucide.createIcons();
    }
  });

  if (window.lucide) window.lucide.createIcons();
}
