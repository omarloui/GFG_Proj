// App entry point for Spec-Driven Development Workspace
document.addEventListener('DOMContentLoaded', () => {
    console.log('🚀 Spec-Driven Development environment successfully initialized.');

    // Theme Toggle Functionality
    const themeToggleBtn = document.getElementById('theme-toggle');
    if (themeToggleBtn) {
        themeToggleBtn.addEventListener('click', () => {
            const currentTheme = document.documentElement.getAttribute('data-theme');
            const newTheme = currentTheme === 'light' ? 'dark' : 'light';
            document.documentElement.setAttribute('data-theme', newTheme);
            themeToggleBtn.textContent = newTheme === 'light' ? 'Dark Theme' : 'Toggle Theme';
        });
    }

    // Let's Get Started Button behavior
    const openSpecBtn = document.getElementById('open-spec-btn');
    if (openSpecBtn) {
        openSpecBtn.addEventListener('click', () => {
            alert('Go ahead and open "specification.md" in your editor. Edit the file to describe the app you want to build!');
        });
    }
});
