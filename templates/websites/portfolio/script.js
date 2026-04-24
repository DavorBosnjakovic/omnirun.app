/* ============================================
   Portfolio — JavaScript
   Handles: mobile nav, project filters, skill
   bar animation, contact form, scroll effects
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

// --- Project Filters ---
const filterBtns = document.querySelectorAll('.filter-btn');
const projectCards = document.querySelectorAll('.project-card');

filterBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    // Update active button
    filterBtns.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');

    const filter = btn.dataset.filter;

    projectCards.forEach(card => {
      if (filter === 'all' || card.dataset.category === filter) {
        card.classList.remove('hidden');
      } else {
        card.classList.add('hidden');
      }
    });
  });
});

// --- Animated Skill Bars ---
function animateSkillBars() {
  const skillFills = document.querySelectorAll('.skill-fill');
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('animated');
          observer.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.3 }
  );
  skillFills.forEach(bar => observer.observe(bar));
}

// --- Toast Notification ---
function showToast(message, duration = 3000) {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), duration);
}

// --- Contact Form ---
function handleSubmit() {
  const name = document.getElementById('name')?.value.trim();
  const email = document.getElementById('email')?.value.trim();
  const subject = document.getElementById('subject')?.value;
  const message = document.getElementById('message')?.value.trim();

  if (!name || !email) {
    showToast('Please fill in your name and email.');
    return;
  }
  if (!email.includes('@') || !email.includes('.')) {
    showToast('Please enter a valid email address.');
    return;
  }

  // Save to localStorage
  const submissions = JSON.parse(localStorage.getItem('portfolio-contacts') || '[]');
  submissions.push({
    id: Date.now(), name, email, subject, message,
    date: new Date().toISOString()
  });
  localStorage.setItem('portfolio-contacts', JSON.stringify(submissions));

  // Clear form
  document.getElementById('name').value = '';
  document.getElementById('email').value = '';
  document.getElementById('subject').value = '';
  document.getElementById('message').value = '';

  showToast('Message sent! I\'ll get back to you soon.');
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

// --- Nav Background on Scroll ---
function initNavScroll() {
  const nav = document.querySelector('.nav');
  if (!nav) return;
  window.addEventListener('scroll', () => {
    nav.style.background = window.scrollY > 20
      ? 'rgba(10, 10, 15, 0.95)'
      : 'rgba(10, 10, 15, 0.8)';
  });
}

// --- Init ---
document.addEventListener('DOMContentLoaded', () => {
  initScrollAnimations();
  initNavScroll();
  animateSkillBars();
});
