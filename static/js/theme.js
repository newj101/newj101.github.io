/*
Java script functions to change and save website theme

Author: Nicholas E. Johnson
Created: 6 November 2025
*/

const toggleBtn = document.getElementById('toggleTheme');

// Function to toggle theme
function toggleTheme(){
	document.body.classList.toggle('dark');
	const isDark = document.body.classList.contains('dark');
	toggleBtn.textContent = isDark ? '☀️ Light' : '🌙 Dark';
	localStorage.setItem('theme', isDark ? 'dark' : 'light');
}

// load saved theme
const savedTheme = localStorage.getItem('theme');
if(savedTheme==='dark'){
	document.body.classList.add('dark');
	toggleBtn.textContent = '☀️ Light';
}