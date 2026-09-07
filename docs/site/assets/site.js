const year = document.querySelector('[data-year]');
if (year) year.textContent = new Date().getFullYear();

for (const button of document.querySelectorAll('[data-copy]')) {
  const original = button.textContent;
  const status = document.querySelector('[data-copy-status]');
  let timer;
  button.addEventListener('click', async () => {
    const value = button.getAttribute('data-copy');
    clearTimeout(timer);
    button.disabled = true;
    try {
      await navigator.clipboard.writeText(value);
      if (status) status.textContent = 'Commande copiée.';
    } catch {
      if (status) status.textContent = 'Copie indisponible. Sélectionne la commande affichée ci-dessus et copie-la manuellement.';
    } finally {
      button.disabled = false;
      button.textContent = original;
      timer = setTimeout(() => { if (status) status.textContent = ''; }, 8000);
    }
  });
}
