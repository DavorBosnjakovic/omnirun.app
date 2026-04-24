/* ============================================
   Business Website — Shared JavaScript
   Handles: mobile nav, contact form, scroll animations
   ============================================ */

// --- Mobile Navigation ---
const navToggle = document.getElementById('navToggle');
const navLinks = document.getElementById('navLinks');

if (navToggle && navLinks) {
  navToggle.addEventListener('click', () => {
    navToggle.classList.toggle('open');
    navLinks.classList.toggle('open');
  });

  // Close mobile nav when clicking a link
  navLinks.querySelectorAll('a').forEach(link => {
    link.addEventListener('click', () => {
      navToggle.classList.remove('open');
      navLinks.classList.remove('open');
    });
  });
}

// --- Toast Notifications ---
function showToast(message, duration = 3000) {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), duration);
}

// --- Contact Form Handler ---
// Saves submissions to localStorage (no backend needed)
function handleSubmit() {
  const firstName = document.getElementById('firstName')?.value.trim();
  const lastName = document.getElementById('lastName')?.value.trim();
  const email = document.getElementById('email')?.value.trim();
  const company = document.getElementById('company')?.value.trim();
  const service = document.getElementById('service')?.value;
  const message = document.getElementById('message')?.value.trim();

  // Basic validation
  if (!firstName || !lastName || !email) {
    showToast('Please fill in all required fields.');
    return;
  }

  if (!email.includes('@') || !email.includes('.')) {
    showToast('Please enter a valid email address.');
    return;
  }

  // Save to localStorage
  const submissions = JSON.parse(localStorage.getItem('novacrest-contacts') || '[]');
  submissions.push({
    id: Date.now(),
    firstName,
    lastName,
    email,
    company,
    service,
    message,
    date: new Date().toISOString()
  });
  localStorage.setItem('novacrest-contacts', JSON.stringify(submissions));

  // Clear form
  document.getElementById('firstName').value = '';
  document.getElementById('lastName').value = '';
  document.getElementById('email').value = '';
  document.getElementById('company').value = '';
  document.getElementById('service').value = '';
  document.getElementById('message').value = '';

  showToast('Message sent! We\'ll get back to you soon.');
}

// --- Scroll Fade-In Animations ---
// Elements with class "fade-in" animate into view on scroll
function initScrollAnimations() {
  const elements = document.querySelectorAll('.fade-in');

  if (!elements.length) return;

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry, index) => {
        if (entry.isIntersecting) {
          // Stagger the animation slightly for grouped elements
          setTimeout(() => {
            entry.target.classList.add('visible');
          }, index * 80);
          observer.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.1, rootMargin: '0px 0px -40px 0px' }
  );

  elements.forEach(el => observer.observe(el));
}

// --- Nav Background on Scroll ---
function initNavScroll() {
  const nav = document.querySelector('.nav');
  if (!nav) return;

  window.addEventListener('scroll', () => {
    if (window.scrollY > 20) {
      nav.style.background = 'rgba(11, 15, 26, 0.95)';
    } else {
      nav.style.background = 'rgba(11, 15, 26, 0.8)';
    }
  });
}

// --- Initialize ---
document.addEventListener('DOMContentLoaded', () => {
  initScrollAnimations();
  initNavScroll();
});
