/*
Java script functions for modals on website

Author: Nicholas E. Johnson
Created: 6 November 2025
*/

// Opens modal and add text from static/documents/ directory based on file name as function input
function openModal(modalID, textName){
	/*
	modal: modal id
	textName: file name containing text to add to modal. Must be in static/documents/ directory with .txt extenstion
	*/
	
	const modal = document.getElementById(modalID)
	const content = document.getElementById(`${modalID}${"Content"}`)
	
	// If text file name is input in function: populate modal with contents of text file
	if (textName) {
		const filePath = `../static/documents/${textName}.txt`;
		console.log(filePath);
		
		fetch(filePath)
			.then(response => {
					if (!response.ok) throw new Error("File not found: " + textName);
					return response.text();
				})
			.then(data => {
				content.innerHTML = data;
			})
			.catch(error => {
				console.error(error);
				content.innerHTML = `Error loading file "${textName}"`;
			});
	}
	
	// Open modal
	modal.style.display = 'flex';
	document.body.style.overflow = 'hidden';
	modal.style.opacity = 1; // reset opacity for fade-out
}

// Function to close modal
function closeModal(modalID){
	document.getElementById(modalID).style.display='none'
	document.body.style.overflow = '';
	
	// Content to reset only in feedback modal
	if (modalID === "feedbackModal") {
		document.getElementById(`${modalID}${"Status"}`).textContent = '';
		document.getElementById(`${modalID}${"Form"}`).reset();
	}
}

// Function to close modal when clicking outside modal
// Does not remove content from feedback modal (in case user clicks outside model while typing feedback)
function enableOutsideClickToClose(modalID) {
    const modal = document.getElementById(modalID);
    if (!modal) return; // This does nothing if modal is not found on page (since this script is usedo nmultiple pages)

    modal.addEventListener("click", (e) => {
        if (e.target === modal) { // only if background is clicked
            document.getElementById(modalID).style.display='none'
			document.body.style.overflow = '';
        }
    });
}

// Enable click outside to close for instruction and feedback modals
enableOutsideClickToClose("projectModal"); // on research page
enableOutsideClickToClose("instructionsModal"); // on sounding plotter page
enableOutsideClickToClose("feedbackModal"); // on sounding plotter page