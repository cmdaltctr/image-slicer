// TODO: Split this into multiple files for better maintainability
/*
 *This script handles the image processing application, including file upload, preview, slicing, and downloading.
 *It uses FileSaver.js for downloading files and JSZip for creating ZIP archives.
 */

document.addEventListener('DOMContentLoaded', function () {
	const uploadBox = document.getElementById('uploadBox');
	const fileInput = document.getElementById('fileInput');
	const fileList = document.getElementById('fileList');
	const heightSlider = document.getElementById('heightSlider');
	const heightInput = document.getElementById('heightInput');
	const previewContainer = document.getElementById('previewContainer');
	const processBtn = document.getElementById('processBtn');
	const downloadAllBtn = document.getElementById('downloadAllBtn');
	const downloadZipBtn = document.getElementById('downloadZipBtn');
	const loadingOverlay = document.getElementById('loadingOverlay');

	// Manages the application's current state and user selections.
	const appState = {
		files: [], // Stores all uploaded file objects
		currentFileIndex: -1, // Index of the file currently shown in the preview
		sliceHeight: 800, // Desired height for slicing or extracting, in pixels
		slices: [], // Stores the generated image slices (dataUrl, filename, dimensions)
		compression: 'lossless', // Selected compression quality
		outputFormat: 'webp', // Selected output image format
		processMode: 'slice', // 'slice' or 'extract'
	};

	// Initialises event listeners and default UI states.
	function init() {
		uploadBox.addEventListener('click', () => fileInput.click());
		fileInput.addEventListener('change', handleFileSelect);
		uploadBox.addEventListener('dragover', handleDragOver);
		uploadBox.addEventListener('dragleave', handleDragLeave);
		uploadBox.addEventListener('drop', handleDrop);

		heightSlider.addEventListener('input', updateHeightValueFromSlider);
		heightInput.addEventListener('input', updateSliceHeightFromInput);
		heightInput.addEventListener('change', finaliseHeightInputOnBlur); // Handles validation when input loses focus

		updateHeightLabel(); // Set initial text for the height input label

		processBtn.addEventListener('click', processImages);
		downloadAllBtn.addEventListener('click', downloadAllSlices);
		downloadZipBtn.addEventListener('click', downloadAsZip);

		document.querySelectorAll('input[name="compression"]').forEach((radio) => {
			radio.addEventListener('change', (e) => {
				appState.compression = e.target.value;
			});
		});

		document.querySelectorAll('input[name="outputFormat"]').forEach((radio) => {
			radio.addEventListener('change', (e) => {
				appState.outputFormat = e.target.value;
				// WebP is the only format supporting true lossless in this context.
				// Disable lossless for other formats and default to high quality.
				if (e.target.value !== 'webp') {
					document.getElementById('compLossless').disabled = true;
					if (document.getElementById('compLossless').checked) {
						document.getElementById('compHigh').checked = true;
						appState.compression = 'high';
					}
				} else {
					document.getElementById('compLossless').disabled = false;
				}
			});
		});

		document.querySelectorAll('input[name="processMode"]').forEach((radio) => {
			radio.addEventListener('change', (e) => {
				appState.processMode = e.target.value;
				updateHeightLabel();
				updateCutLines(); // Refresh preview lines when mode changes
			});
		});
	}

	// --- File Handling Functions ---
	function handleFileSelect(e) {
		const files = e.target.files;
		if (files.length > 0) {
			addFilesToState(Array.from(files));
		}
	}

	function handleDragOver(e) {
		e.preventDefault();
		e.stopPropagation();
		uploadBox.classList.add('upload-box-active');
	}

	function handleDragLeave(e) {
		e.preventDefault();
		e.stopPropagation();
		uploadBox.classList.remove('upload-box-active');
	}

	function handleDrop(e) {
		e.preventDefault();
		e.stopPropagation();
		uploadBox.classList.remove('upload-box-active');
		const files = e.dataTransfer.files;
		if (files.length > 0) {
			addFilesToState(Array.from(files));
		}
	}

	function addFilesToState(newFiles) {
		newFiles.forEach((file) => {
			if (file.type.match('image.*')) {
				appState.files.push(file);
			}
		});
		renderFileList();

		// If it's the first file(s) being added, show the first one in preview.
		if (appState.files.length > 0 && appState.currentFileIndex === -1) {
			appState.currentFileIndex = 0;
			showPreview(appState.files[0]);
		}
	}

	// Dynamically builds the list of uploaded files with preview/remove actions.
	function renderFileList() {
		fileList.innerHTML = '';
		appState.files.forEach((file, index) => {
			const fileItem = document.createElement('div');
			fileItem.className = 'file-item';

			const fileName = document.createElement('div');
			fileName.className = 'file-name';
			fileName.textContent = file.name;

			const fileActions = document.createElement('div');
			fileActions.className = 'file-actions';

			const previewBtn = document.createElement('button');
			previewBtn.textContent = 'Preview';
			previewBtn.addEventListener('click', () => {
				appState.currentFileIndex = index;
				showPreview(file);
			});

			const removeBtn = document.createElement('button');
			removeBtn.textContent = 'Remove';
			removeBtn.addEventListener('click', () => {
				appState.files.splice(index, 1);
				renderFileList(); // Re-render the list after removal

				// Adjust current preview if the removed file was active or before the active one.
				if (appState.currentFileIndex === index) {
					if (appState.files.length > 0) {
						appState.currentFileIndex = Math.max(0, index - 1); // Show previous or first
						showPreview(appState.files[appState.currentFileIndex]);
					} else {
						appState.currentFileIndex = -1;
						resetPreview();
					}
				} else if (appState.currentFileIndex > index) {
					appState.currentFileIndex--; // Adjust index if a preceding file was removed
				}
			});

			fileActions.appendChild(previewBtn);
			fileActions.appendChild(removeBtn);
			fileItem.appendChild(fileName);
			fileItem.appendChild(fileActions);
			fileList.appendChild(fileItem);
		});
	}

	// --- Height Control Functions ---
	// Updates sliceHeight and input field when the slider is moved.
	function updateHeightValueFromSlider(e) {
		const valueFromSlider = parseInt(e.target.value);
		appState.sliceHeight = valueFromSlider;
		heightInput.value = valueFromSlider;
		updateCutLines();
	}

	// Updates sliceHeight and slider when the number input field changes.
	// Allows typing values outside the slider's visual range (e.g., up to 5000px).
	function updateSliceHeightFromInput(e) {
		const rawValue = e.target.value;
		const inputFieldMin = parseInt(heightInput.min);
		const inputFieldMax = parseInt(heightInput.max);

		if (rawValue.trim() === '') {
			// If input is cleared, temporarily use min value for appState.
			// finaliseHeightInputOnBlur will set the input field's text.
			appState.sliceHeight = inputFieldMin;
		} else {
			const numericValue = parseInt(rawValue);
			if (!isNaN(numericValue)) {
				// Clamp the numeric value to the input field's defined min/max.
				if (numericValue < inputFieldMin) {
					appState.sliceHeight = inputFieldMin;
				} else if (numericValue > inputFieldMax) {
					appState.sliceHeight = inputFieldMax;
				} else {
					appState.sliceHeight = numericValue;
				}
			}
			// If input is not a number (e.g. "abc"), appState.sliceHeight retains its last valid value.
			// finaliseHeightInputOnBlur will correct the input field's text.
		}
		// Slider visually reflects appState.sliceHeight, clamping to its own max if necessary.
		heightSlider.value = appState.sliceHeight;
		updateCutLines();
	}

	// Corrects the height input field's displayed value when it loses focus (on 'change' event).
	// Ensures the input field shows a valid, clamped number corresponding to appState.sliceHeight.
	function finaliseHeightInputOnBlur() {
		const rawValue = heightInput.value;
		if (rawValue.trim() === '' || isNaN(parseInt(rawValue))) {
			// If input is empty or not a number on blur, set input text to current appState.sliceHeight.
			heightInput.value = appState.sliceHeight;
		} else {
			// If it's a number, ensure input text matches the (already clamped) appState.sliceHeight.
			// This handles cases like typing "50" (appState became 100), input should show "100".
			if (parseInt(heightInput.value) !== appState.sliceHeight) {
				heightInput.value = appState.sliceHeight;
			}
		}
		// Ensure slider is also in sync.
		heightSlider.value = appState.sliceHeight;
		updateCutLines();
	}

	// Updates the label for the height input based on the current processing mode.
	function updateHeightLabel() {
		const sliceHeightLabel = document.querySelector('label[for="sliceHeight"]');
		if (appState.processMode === 'slice') {
			sliceHeightLabel.textContent = 'Slice Height (px)';
		} else {
			sliceHeightLabel.textContent = 'Extract Height (px)';
		}
	}

	// --- Preview Functions ---
	function showPreview(file) {
		const reader = new FileReader();
		reader.onload = function (e) {
			previewContainer.innerHTML = '';
			const previewImageDiv = document.createElement('div');
			previewImageDiv.className = 'preview-image';

			const imgElement = new Image();
			imgElement.alt = file.name;
			imgElement.style.display = 'block';
			imgElement.style.maxWidth = '100%';
			imgElement.style.height = 'auto';

			imgElement.onload = function () {
				updateCutLines(); // Draw cut lines once image is loaded and dimensions are known
			};
			imgElement.onerror = function () {
				console.error('Error loading image for preview.');
				previewContainer.innerHTML = '<p>Error loading image preview.</p>';
			};
			previewImageDiv.appendChild(imgElement);
			previewContainer.appendChild(previewImageDiv);
			imgElement.src = e.target.result;
		};
		reader.onerror = function () {
			console.error('Error reading file for preview.');
			previewContainer.innerHTML = '<p>Error reading file.</p>';
		};
		reader.readAsDataURL(file);
	}

	// Draws lines on the preview image indicating where slices or extraction will occur.
	function updateCutLines() {
		const previewImageDiv = previewContainer.querySelector('.preview-image');
		if (!previewImageDiv) return;

		previewImageDiv.querySelectorAll('.cut-line').forEach((el) => el.remove());

		if (appState.currentFileIndex === -1) return;
		const imgElement = previewImageDiv.querySelector('img');
		if (!imgElement || !imgElement.complete || imgElement.naturalHeight === 0) return;

		const displayedImgHeight = imgElement.offsetHeight;
		const naturalImgHeight = imgElement.naturalHeight;
		const displayedImgWidth = imgElement.offsetWidth;
		if (naturalImgHeight === 0) return;

		const scaleFactor = displayedImgHeight / naturalImgHeight;
		const targetSliceHeightFromApp = appState.sliceHeight;

		if (appState.processMode === 'extract') {
			if (targetSliceHeightFromApp > 0) {
				let scaledExtractPosition = targetSliceHeightFromApp * scaleFactor;
				scaledExtractPosition = Math.min(scaledExtractPosition, displayedImgHeight);

				const cutLine = document.createElement('div');
				cutLine.className = 'cut-line extract-line'; // 'extract-line' for specific styling
				cutLine.style.top = `${scaledExtractPosition}px`;
				cutLine.style.width = `${displayedImgWidth}px`;
				cutLine.dataset.height = `${targetSliceHeightFromApp}px`; // For CSS to display height
				previewImageDiv.appendChild(cutLine);
			}
		} else {
			// 'slice' mode
			const numSlicesBasedOnNatural = Math.ceil(naturalImgHeight / targetSliceHeightFromApp);
			for (let i = 1; i < numSlicesBasedOnNatural; i++) {
				const naturalLinePos = i * targetSliceHeightFromApp;
				const scaledLinePos = naturalLinePos * scaleFactor;
				if (scaledLinePos < displayedImgHeight) {
					const cutLine = document.createElement('div');
					cutLine.className = 'cut-line';
					cutLine.style.top = `${scaledLinePos}px`;
					cutLine.style.width = `${displayedImgWidth}px`;
					cutLine.dataset.height = `${targetSliceHeightFromApp}px`;
					previewImageDiv.appendChild(cutLine);
				}
			}
		}
	}

	function resetPreview() {
		previewContainer.innerHTML = `
            <div class="preview-placeholder">
                <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                    <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                    <circle cx="8.5" cy="8.5" r="1.5"></circle>
                    <polyline points="21 15 16 10 5 21"></polyline>
                </svg>
                <p>Upload an image to see the preview</p>
            </div>
        `;
	}

	// --- Image Processing Functions ---
	async function processImages() {
		if (appState.files.length === 0) {
			alert('Please upload at least one image.');
			return;
		}
		showLoading(true);
		appState.slices = []; // Clear previous slices

		try {
			for (const file of appState.files) {
				// Process all uploaded files
				const imageSlices = await sliceImage(file); // Renamed for clarity
				appState.slices.push(...imageSlices);
			}
			showSlicePreview(); // Display all generated slices
			enableDownloadButtons();
		} catch (error) {
			console.error('Error processing images:', error);
			alert('Error processing images. Please try again.');
		} finally {
			showLoading(false);
		}
	}

	function showLoading(show) {
		loadingOverlay.style.display = show ? 'flex' : 'none';
	}

	// Core image processing logic: slices or extracts a portion of an image.
	async function sliceImage(file) {
		return new Promise((resolve, reject) => {
			const reader = new FileReader();
			reader.onload = function (e) {
				const img = new Image();
				img.onload = function () {
					const generatedSlices = []; // Renamed for clarity
					const sliceHeightSetting = appState.sliceHeight;
					const { width, height } = img; // Original image dimensions

					const formatExtension = appState.outputFormat === 'jpeg' ? 'jpg' : appState.outputFormat;
					const mimeType = `image/${appState.outputFormat}`;
					let quality;
					switch (appState.compression) {
						case 'high':
							quality = 0.9;
							break;
						case 'medium':
							quality = 0.75;
							break;
						case 'low':
							quality = 0.5;
							break;
						case 'lossless': // For WebP lossless, quality param is complex; for others, it implies max.
							quality = appState.outputFormat === 'webp' ? 1.0 : 1.0; // Adjust if specific lossless handling for WebP is needed
							break;
						default:
							quality = 1.0;
					}
					// For non-WebP formats, 'lossless' effectively means highest quality for that format.
					if (appState.outputFormat !== 'webp' && appState.compression === 'lossless') {
						quality = 1.0;
					}

					if (appState.processMode === 'extract') {
						const canvas = document.createElement('canvas');
						const ctx = canvas.getContext('2d');
						const extractActualHeight = Math.min(sliceHeightSetting, height);
						canvas.width = width;
						canvas.height = extractActualHeight;
						ctx.drawImage(img, 0, 0, width, extractActualHeight, 0, 0, width, extractActualHeight);
						const dataUrl = canvas.toDataURL(mimeType, quality);
						generatedSlices.push({
							dataUrl,
							filename: `${file.name.substring(0, file.name.lastIndexOf('.'))}_extracted.${formatExtension}`,
							width,
							height: extractActualHeight,
						});
					} else {
						// Slice Mode
						const numSlices = Math.ceil(height / sliceHeightSetting);
						for (let i = 0; i < numSlices; i++) {
							const canvas = document.createElement('canvas');
							const ctx = canvas.getContext('2d');
							const currentSliceActualHeight = Math.min(
								sliceHeightSetting,
								height - i * sliceHeightSetting,
							);
							canvas.width = width;
							canvas.height = currentSliceActualHeight;
							ctx.drawImage(
								img,
								0,
								i * sliceHeightSetting,
								width,
								currentSliceActualHeight,
								0,
								0,
								width,
								currentSliceActualHeight,
							);
							const dataUrl = canvas.toDataURL(mimeType, quality);
							generatedSlices.push({
								dataUrl,
								filename: `${file.name.substring(0, file.name.lastIndexOf('.'))}_slice_${i + 1}.${formatExtension}`,
								width,
								height: currentSliceActualHeight,
							});
						}
					}
					resolve(generatedSlices);
				};
				img.onerror = (err) => reject(new Error('Image failed to load for slicing: ' + err));
				img.src = e.target.result;
			};
			reader.onerror = (err) => reject(new Error('File reading failed: ' + err));
			reader.readAsDataURL(file);
		});
	}

	// --- Post-Processing and UI Update Functions ---
	// Displays previews of all generated slices after processing.
	function showSlicePreview() {
		previewContainer.innerHTML = '';
		const splitPreview = document.createElement('div');
		splitPreview.className = 'split-preview';

		appState.slices.forEach((slice, index) => {
			const sliceContainer = document.createElement('div');
			sliceContainer.className = 'slice-container';

			const img = document.createElement('img');
			img.src = slice.dataUrl;
			img.alt = `Slice ${index + 1}`;

			const sliceDimensions = document.createElement('div'); // Renamed for clarity
			sliceDimensions.className = 'slice-dimensions'; // CSS class name more descriptive
			sliceDimensions.textContent = `${slice.width} × ${slice.height}px`;

			sliceContainer.appendChild(img);
			sliceContainer.appendChild(sliceDimensions);
			splitPreview.appendChild(sliceContainer);
		});
		previewContainer.appendChild(splitPreview);
	}

	function enableDownloadButtons() {
		downloadAllBtn.disabled = appState.slices.length === 0;
		downloadZipBtn.disabled = appState.slices.length === 0;
	}

	// --- Download Functions ---
	// Converts a data URL string to a Blob object.
	async function dataURLtoBlob(dataurl) {
		const response = await fetch(dataurl);
		const blob = await response.blob();
		return blob;
	}

	async function downloadAllSlices() {
		if (appState.slices.length === 0) {
			alert('No slices to download. Please process images first.');
			return;
		}
		if (typeof saveAs === 'undefined') {
			alert('FileSaver.js is not loaded. Cannot download files.');
			console.error('FileSaver.js (saveAs) is not defined.');
			return;
		}
		showLoading(true);
		try {
			for (const slice of appState.slices) {
				const blob = await dataURLtoBlob(slice.dataUrl);
				saveAs(blob, slice.filename); // Uses FileSaver.js to trigger download
				await new Promise((resolve) => setTimeout(resolve, 200)); // Brief pause for multiple downloads
			}
		} catch (error) {
			console.error('Error downloading slices:', error);
			alert('An error occurred while downloading the slices.');
		} finally {
			showLoading(false);
		}
	}

	async function downloadAsZip() {
		if (appState.slices.length === 0) {
			alert('No slices to download. Please process images first.');
			return;
		}
		if (typeof JSZip === 'undefined') {
			alert('JSZip library is not loaded. Cannot create ZIP file.');
			console.error('JSZip is not defined.');
			return;
		}
		if (typeof saveAs === 'undefined') {
			alert('FileSaver.js is not loaded. Cannot download ZIP file.');
			console.error('FileSaver.js (saveAs) is not defined.');
			return;
		}
		showLoading(true);
		try {
			const zip = new JSZip();
			for (const slice of appState.slices) {
				// Iterate directly over slices
				const blob = await dataURLtoBlob(slice.dataUrl);
				zip.file(slice.filename, blob);
			}
			const zipBlob = await zip.generateAsync({ type: 'blob' });
			saveAs(zipBlob, 'image_slices.zip'); // Uses FileSaver.js
		} catch (error) {
			console.error('Error creating or saving ZIP:', error);
			alert('Error creating or saving ZIP file.');
		} finally {
			showLoading(false);
		}
	}

	init(); // Start the application
});
