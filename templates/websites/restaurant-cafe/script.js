/* ============================================
   Restaurant / Café — JavaScript
   Handles: menu tabs, reservation form,
   mobile nav, scroll animations
   ============================================ */

// --- Mobile Navigation ---
const navToggle = document.getElementById('navToggle');
const navLinks = document.getElementById('navLinks');

if (navToggle && navLinks) {
  navToggle.addEventListener('click', () => {
    navToggle.classList.toggle('open');
    navLinks.classList.toggle('open');
  });
  navLinks.querySelectorAll('a').forEach(link => {
    link.addEventListener('click', () => {
      navToggle.classList.remove('open');
      navLinks.classList.remove('open');
    });
  });
}

// --- Menu Category Tabs ---
const menuTabs = document.querySelectorAll('.menu-tab');
const menuPanels = document.querySelectorAll('.menu-panel');

menuTabs.forEach(tab => {
  tab.addEventListener('click', () => {
    // Update active tab
    menuTabs.forEach(t => t.classList.remove('active'));
    tab.classList.add('active');

    // Show matching panel
    const target = tab.dataset.tab;
    menuPanels.forEach(panel => {
      panel.classList.remove('active');
      if (panel.id === `panel-${target}`) {
        panel.classList.add('active');
        // Re-trigger fade-in for items in this panel
        panel.querySelectorAll('.fade-in').forEach(el => {
          el.classList.remove('visible');
          setTimeout(() => el.classList.add('visible'), 50);
        });
      }
    });
  });
});

// --- Toast Notification ---
function showToast(message, duration = 3500) {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), duration);
}

// --- Reservation Form ---
function handleReservation() {
  const name = document.getElementById('resName')?.value.trim();
  const email = document.getElementById('resEmail')?.value.trim();
  const phone = document.getElementById('resPhone')?.value.trim();
  const date = document.getElementById('resDate')?.value;
  const time = document.getElementById('resTime')?.value;
  const guests = document.getElementById('resGuests')?.value;
  const notes = document.getElementById('resNotes')?.value.trim();

  // Validate required fields
  if (!name || !email || !date || !time || !guests) {
    showToast('Please fill in all required fields.');
    return;
  }
  if (!email.includes('@') || !email.includes('.')) {
    showToast('Please enter a valid email address.');
    return;
  }

  // Save to localStorage
  const reservations = JSON.parse(localStorage.getItem('emberoak-reservations') || '[]');
  reservations.push({
    id: Date.now(), name, email, phone, date, time, guests, notes,
    status: 'pending',
    created: new Date().toISOString()
  });
  localStorage.setItem('emberoak-reservations', JSON.stringify(reservations));

  // Clear form
  document.getElementById('resName').value = '';
  document.getElementById('resEmail').value = '';
  document.getElementById('resPhone').value = '';
  document.getElementById('resDate').value = '';
  document.getElementById('resTime').value = '';
  document.getElementById('resGuests').value = '';
  document.getElementById('resNotes').value = '';

  showToast('Reservation requested! We\'ll confirm by email shortly.');
}

// --- Scroll Fade-In ---
function initScrollAnimations() {
  const elements = document.querySelectorAll('.fade-in');
  if (!elements.length) return;

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry, index) => {
        if (entry.isIntersecting) {
          setTimeout(() => entry.target.classList.add('visible'), index * 60);
          observer.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.1, rootMargin: '0px 0px -30px 0px' }
  );
  elements.forEach(el => observer.observe(el));
}

// --- Nav Scroll Effect ---
function initNavScroll() {
  const nav = document.querySelector('.nav');
  if (!nav) return;
  window.addEventListener('scroll', () => {
    nav.style.background = window.scrollY > 20
      ? 'rgba(14, 12, 10, 0.95)'
      : 'rgba(14, 12, 10, 0.85)';
  });
}

// --- Set minimum date for reservation to today ---
function initDatePicker() {
  const dateInput = document.getElementById('resDate');
  if (dateInput) {
    const today = new Date().toISOString().split('T')[0];
    dateInput.setAttribute('min', today);
  }
}

// --- Init ---
document.addEventListener('DOMContentLoaded', () => {
  initScrollAnimations();
  initNavScroll();
  initDatePicker();
});
