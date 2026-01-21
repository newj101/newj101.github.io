/*
Java script functions to handle dropdown header for smaller windows on home page

Author: Nicholas E. Johnson
Created: 21 January 2026
*/


// Handle header navigation dropdown for mobile
const toggle = document.querySelector('.nav-toggle');
const dropdown = document.querySelector('.nav-links');

// Toggle dropdown when clicking button
toggle.addEventListener('click', (e) => {
  e.stopPropagation();  // prevent immediate close
  dropdown.classList.toggle('show');
});

// Close dropdown when clicking outside
document.addEventListener('click', (e) => {
  if (!dropdown.contains(e.target) && !toggle.contains(e.target)) {
	dropdown.classList.remove('show');
  }
});

// Close dropdown when clicking any item inside
dropdown.querySelectorAll('a, button').forEach(item => {
  item.addEventListener('click', () => {
	dropdown.classList.remove('show');
  });
});