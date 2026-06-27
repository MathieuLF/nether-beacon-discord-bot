const year = document.querySelector('[data-year]');
if (year) year.textContent = new Date().getFullYear();

for (const button of document.querySelectorAll('[data-copy]')) {
  button.addEventListener('click', async () => {
    const value = button.getAttribute('data-copy');
    try {
      await navigator.clipboard.writeText(value);
      const original = button.textContent;
      button.textContent = 'Copied';
      setTimeout(() => {
        button.textContent = original;
      }, 1400);
    } catch (error) {
      button.textContent = 'Copy failed';
    }
  });
}
