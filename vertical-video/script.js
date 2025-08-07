class VerticalVideoPlayer {
    constructor() {
        this.playlist = [];
        this.currentIndex = 0;
        this.isFullscreen = false;
        this.autoplayInterval = null;
        this.touchStartY = 0;
        this.touchEndY = 0;
        this.isProgrammaticScroll = false;
        this.lastPlayedVideo = null; // Keep track of the last video that was played.
        this.isManuallyScrolling = false; // Flag to prevent race conditions during scroll.
        this.realItemCount = 0; // The number of actual slides (videos + ads), excluding clones.
        this.intersectionObserver = null; // For lazy-loading carousel videos
        this.gptInitialized = false; // Avoid initializing GPT until first fullscreen
        
        // Define the ended handler once and bind it for consistent reference.
        this.videoEndedHandler = this.handleVideoEndedInCarousel.bind(this);
        this.fullscreenVideoEndedHandler = this.handleVideoEndedInFullscreen.bind(this);
        
        this.initializeElements();
        this.bindEvents();
        this.loadSampleVideos();
        
        // Preload the ad image for better performance
        this.preloadAdImage();
        
        // IMA SDK will be initialized when needed for video ads
        this.leftMarginAdSlot = null;
        // Defer GPT init until user enters fullscreen to avoid unused script work
        // GPT will be initialized on first fullscreen open
        
        // Start autoplay after videos are loaded
        // Don't start autoplay here - it will be started after renderCarousel()
    }

    ensureIMAScriptLoaded() {
        return new Promise((resolve, reject) => {
            // Check if IMA script is already loaded
            if (typeof google !== 'undefined' && google.ima) {
                console.log('IMA script already loaded');
                resolve();
                return;
            }
            
            console.log('IMA script not loaded, attempting to load it...');
            
            // Create and load the IMA script
            const script = document.createElement('script');
            script.src = 'https://imasdk.googleapis.com/js/sdkloader/ima3.js';
            script.async = true;
            
            script.onload = () => {
                console.log('IMA script loaded successfully');
                // Wait a bit for the SDK to initialize
                setTimeout(() => {
                    if (typeof google !== 'undefined' && google.ima) {
                        console.log('IMA SDK ready');
                        resolve();
                    } else {
                        console.warn('IMA SDK not ready after loading');
                        reject(new Error('IMA SDK not ready'));
                    }
                }, 1000);
            };
            
            script.onerror = () => {
                console.error('Failed to load IMA script');
                reject(new Error('Failed to load IMA script'));
            };
            
            document.head.appendChild(script);
        });
    }

    onAdsManagerLoaded(adsManagerLoadedEvent) {
        // Ads manager loaded, ready to play ads
        console.log('IMA Ads Manager loaded');
        const imaVideo = document.querySelector('#imaVideo');
        if (imaVideo) {
            this.adsManager = adsManagerLoadedEvent.getAdsManager(imaVideo, this);
        } else {
            console.warn('IMA video element not ready');
        }
    }

    onAdError(adErrorEvent) {
        console.error('IMA Ad Error:', adErrorEvent.getError());
        // Continue to next video if ad fails
        this.continueToNextVideoAfterAd();
    }

    async playVideoAd() {
        console.log('🎬 Trying to play video ad...');

        if (!this.fullscreenVideo) {
            console.warn('Cannot play ad, fullscreen video element not found.');
            this.continueToNextVideoAfterAd();
            return;
        }

        try {
            await this.ensureIMAScriptLoaded();
            console.log('IMA script loaded, proceeding with ad playback.');
            await this.playIMAVideoAd();
        } catch (error) {
            console.warn('IMA ad failed to play, falling back to placeholder.', error);
            this.playPlaceholderAd();
        } finally {
            console.log('Ad flow finished.');
            if (this.isFullscreen) {
                console.log('Continuing to next video because fullscreen is active.');
                this.continueToNextVideoAfterAd();
            } else {
                console.log('Fullscreen was closed during ad, not continuing to next video.');
            }
        }
    }

    destroyIMAAd() {
        if (this.adsManager) {
            this.adsManager.destroy();
            this.adsManager = null;
        }
        if (this.adsLoader) {
            this.adsLoader.destroy();
            this.adsLoader = null;
        }
        const imaAdContainer = document.getElementById('imaAdContainer');
        if (imaAdContainer) {
            imaAdContainer.remove();
        }
        // If there's a pending ad promise, resolve it now.
        if (this._adResolve) {
            this._adResolve();
            this._adResolve = null;
        }
    }

    playIMAVideoAd() {
        return new Promise((resolve, reject) => {
            this._adResolve = resolve; // Store the resolve function
            console.log('🎬 Starting actual IMA video ad playback...');

            // 1. Create the UI for the ad
            this.fullscreenVideo.style.display = 'none';
            const fullscreenContainer = this.fullscreenModal.querySelector('.fullscreen-container');
            
            // Ad container with a fixed width, centered by the parent's flexbox
            fullscreenContainer.innerHTML = `
                <div id="imaAdContainer" style="width: 485px; aspect-ratio: 9/16; max-height: 95vh; background: #000; position: relative; display: flex; align-items: center; justify-content: center;">
                    <video id="imaVideoContent" style="width: 100%; height: 100%;"></video>
                    <div id="ima-skip-container" style="position: absolute; bottom: 20px; right: 10px; background: rgba(0,0,0,0.7); padding: 12px 18px; border-radius: 8px; display: none; cursor: pointer; z-index: 10;">
                        <span id="ima-countdown-text" style="color: white; font-family: sans-serif; font-size: 18px;"></span>
                        <button id="ima-skip-button" style="display: none; background: none; border: none; color: white; font-family: sans-serif; font-size: 18px; cursor: pointer;">Skip Ad</button>
                    </div>
                </div>
            `;

            const adContainer = fullscreenContainer.querySelector('#imaAdContainer');
            const videoContent = fullscreenContainer.querySelector('#imaVideoContent');
            const skipContainer = fullscreenContainer.querySelector('#ima-skip-container');
            const countdownText = fullscreenContainer.querySelector('#ima-countdown-text');
            const skipButton = fullscreenContainer.querySelector('#ima-skip-button');

            // 2. Set up IMA objects
            const adDisplayContainer = new google.ima.AdDisplayContainer(adContainer, videoContent);
            adDisplayContainer.initialize();

            const adsLoader = new google.ima.AdsLoader(adDisplayContainer);
            this.adsLoader = adsLoader; // Store reference

            // 3. Add event listeners
            adsLoader.addEventListener(google.ima.AdsManagerLoadedEvent.Type.ADS_MANAGER_LOADED, (event) => {
                console.log('AdsManager loaded.');
                const adsManager = event.getAdsManager(videoContent);
                this.adsManager = adsManager; // Store reference

                adsManager.addEventListener(google.ima.AdErrorEvent.Type.AD_ERROR, (adErrorEvent) => {
                    console.error('AdsManager error:', adErrorEvent.getError());
                    this.destroyIMAAd();
                    reject(new Error(adErrorEvent.getError().getMessage()));
                });

                adsManager.addEventListener(google.ima.AdEvent.Type.ALL_ADS_COMPLETED, () => {
                    console.log('All ads completed.');
                    this.destroyIMAAd();
                    resolve();
                });
                
                adsManager.addEventListener(google.ima.AdEvent.Type.LOADED, () => console.log('Ad loaded.'));
                
                adsManager.addEventListener(google.ima.AdEvent.Type.STARTED, () => {
                    console.log('Ad started, starting skip countdown.');
                    skipContainer.style.display = 'block';
                    let countdown = 2;
                    countdownText.textContent = `Skip in ${countdown}...`;

                    const countdownInterval = setInterval(() => {
                        countdown--;
                        countdownText.textContent = `Skip in ${countdown}...`;
                        if (countdown <= 0) {
                            clearInterval(countdownInterval);
                            countdownText.style.display = 'none';
                            skipButton.style.display = 'block';
                        }
                    }, 1000);
                });

                skipButton.addEventListener('click', () => {
                    console.log('Simulated skip button clicked.');
                    this.destroyIMAAd();
                    resolve();
                });

                adsManager.addEventListener(google.ima.AdEvent.Type.COMPLETE, () => console.log('Single ad complete.'));


                try {
                    adsManager.init(adContainer.clientWidth, adContainer.clientHeight, google.ima.ViewMode.FULLSCREEN);
                    adsManager.start();
                } catch (adError) {
                    console.error('AdsManager could not be started:', adError);
                    adsManager.destroy();
                    reject(adError);
                }
            }, false);

            adsLoader.addEventListener(google.ima.AdErrorEvent.Type.AD_ERROR, (adErrorEvent) => {
                console.error('AdsLoader error:', adErrorEvent.getError());
                reject(new Error('AdsLoader failed: ' + adErrorEvent.getError().getMessage()));
            }, false);

            // 4. Create and send ad request
            const adsRequest = new google.ima.AdsRequest();
            adsRequest.adTagUrl = 'https://pubads.g.doubleclick.net/gampad/ads?iu=/21775744923/external/single_vertical_ad_samples&sz=360x640&gdfp_req=1&output=vast&unviewed_position_start=1&env=vp&correlator=' + Date.now();
            
            console.log('Requesting ads from URL:', adsRequest.adTagUrl);
            adsLoader.requestAds(adsRequest);
        });
    }

    playPlaceholderAd() {
        console.log('🎬 Playing placeholder video ad');
        
        // Hide the video element
        this.fullscreenVideo.style.display = 'none';
        
        // Create a placeholder video ad content sized like fullscreen video
        const container = this.fullscreenModal.querySelector('.fullscreen-container');
        container.innerHTML = `
            <div class="video-wrapper">
                <div class="video-ad-placeholder" style="
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    justify-content: center;
                    max-width: 100%;
                    max-height: 100%;
                    width: auto;
                    height: auto;
                    aspect-ratio: 9/16;
                    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                    color: white;
                    font-family: Arial, sans-serif;
                    text-align: center;
                    object-fit: contain;
                    min-height: 200px;
                    min-width: 485px;
                    box-shadow: 0 0 20px rgba(0, 0, 0, 0.5);
                ">
                    <div style="font-size: 32px; margin-bottom: 30px;">🎬 Video Advertisement</div>
                    <div style="font-size: 24px; margin-bottom: 40px;">Google IMA SDK Video Ad</div>
                    <div style="font-size: 18px; opacity: 0.8; margin-bottom: 30px;">Loading...</div>
                    <div id="videoAdCountdown" style="font-size: 72px; font-weight: bold;">3</div>
                </div>
            </div>
        `;
        
        // Start countdown timer (3 seconds for video ad)
        let countdown = 3;
        const countdownElement = container.querySelector('#videoAdCountdown');
        
        const countdownInterval = setInterval(() => {
            countdown--;
            if (countdownElement) {
                countdownElement.textContent = countdown;
            }
            
            if (countdown <= 0) {
                clearInterval(countdownInterval);
                console.log('Video ad placeholder finished');
                this.continueToNextVideoAfterAd();
            }
        }, 1000);
        
        // Store the interval so we can clear it if needed
        this.currentVideoAdCountdownInterval = countdownInterval;
    }

    onAdLoaded(event) {
        console.log('IMA Ad loaded');
    }

    onAdStarted(event) {
        console.log('IMA Ad started');
    }

    onAdComplete(event) {
        console.log('IMA Ad completed');
        this.continueToNextVideoAfterAd();
    }

    continueToNextVideoAfterAd() {
        console.log('Continuing to next video after video ad');
        
        // Advance to next video after ad completion
        this.advanceToNextVideo();
        
        // Find the current item to get the correct videoIndex
        const currentItem = this.carousel.querySelector(`[data-index="${this.currentIndex}"]`);
        if (!currentItem || typeof currentItem.dataset.videoIndex === 'undefined') {
            console.error(`Cannot continue: current item is an ad or invalid (index: ${this.currentIndex})`);
             // We've landed on an ad. The ad logic should handle this, but as a fallback,
             // let's try to find the next *video* slide.
            this.advanceToNextVideo(); // This will skip the ad.
            this.loadVideoInFullscreen();
            return;
        }

        const videoIndex = parseInt(currentItem.dataset.videoIndex, 10);
        
        // Get the next video before rebuilding the interface
        const nextVideo = this.playlist[videoIndex];
        if (!nextVideo) {
            console.error('No next video found');
            return;
        }
        
        // Restore the complete fullscreen interface
        this.fullscreenModal.innerHTML = `
            <div class="fullscreen-content-wrapper">
                <div class="fullscreen-container">
                    <div class="video-wrapper">
                        <video id="fullscreenVideo" controls>
                            Your browser does not support the video tag.
                        </video>
                    </div>
                    <button class="control-btn prev-btn" id="prevBtn">↑</button>
                    <button class="control-btn next-btn" id="nextBtn">↓</button>
                </div>
            </div>
            <button class="control-btn close-btn" id="closeBtn">✕</button>
        `;
        
        // Re-initialize the element references from the new DOM
        this.initializeElements();
        
        // Re-bind event listeners for the new buttons
        this.prevBtn.addEventListener('click', () => this.previousVideo());
        this.nextBtn.addEventListener('click', () => this.nextVideo());
        this.closeBtn.addEventListener('click', () => this.closeFullscreen());
        
        // After rebuilding the DOM, we need to show the GPT ad again
        this.showLeftMarginAd();
        
        // Preload the video before playing to reduce jump
        // Fade out briefly before changing source
        this.fullscreenVideo.style.opacity = '0.8';
            this.fullscreenVideo.src = nextVideo.src;
        
        // Add a small delay to ensure smooth transition
        setTimeout(() => {
            this.playVideo(this.fullscreenVideo);
        }, 100);
        
        // Add a fade-in effect when video is ready
        this.fullscreenVideo.addEventListener('loadeddata', () => {
            this.fullscreenVideo.style.opacity = '1';
        }, { once: true });
        
        this.updateActiveVideo();
    }

    playVideo(videoElement) {
        // Pause all other videos in the document
        document.querySelectorAll('video').forEach(vid => {
            if (vid !== videoElement) {
                vid.pause();
            }
        });

        // Play the requested video
        if (videoElement) {
            const playPromise = videoElement.play();
            if (playPromise !== undefined) {
                playPromise.catch(error => {
                    console.log('Video autoplay was interrupted:', error);
                });
            }
        }
    }

    initializeElements() {
        this.carousel = document.getElementById('videoCarousel');
        this.carouselPrev = document.getElementById('carouselPrev');
        this.carouselNext = document.getElementById('carouselNext');
        this.fullscreenModal = document.getElementById('fullscreenModal');
        this.fullscreenVideo = document.getElementById('fullscreenVideo');
        this.prevBtn = document.getElementById('prevBtn');
        this.nextBtn = document.getElementById('nextBtn');
        this.closeBtn = document.getElementById('closeBtn');

        
        // Create the container for the left margin ad and append it to the modal
        this.leftMarginAdContainer = document.createElement('div');
        this.leftMarginAdContainer.className = 'full-screen-left-margin-ad';
        this.leftMarginAdContainer.id = 'banner-ad'; // This ID is targeted by the GPT tag
        this.fullscreenModal.appendChild(this.leftMarginAdContainer);
    }

    async initializeLeftMarginAd() {
        try {
            await this.ensureGptScriptLoaded();
            console.log('GPT script ready, defining the left margin ad slot.');

            window.googletag.cmd.push(() => {
                // Set all ad slots on this page to open in a new tab.
                googletag.pubads().setTargeting('goog_blank', 'true');
                
                // Define the slot and store a reference to it.
                this.leftMarginAdSlot = googletag
                    .defineSlot("/6355419/Travel/Europe/France/Paris", [300, 250], "banner-ad")
                    .addService(googletag.pubads());
                
                // Enable services, which is required before ads can be requested.
                googletag.pubads().enableSingleRequest();
                googletag.enableServices();
                
                console.log('Left margin ad slot defined and ready to be used.');
            });
        } catch (error) {
            console.error('Could not initialize the GPT left margin ad:', error);
        }
    }

    ensureGptScriptLoaded() {
        return new Promise((resolve, reject) => {
            if (window.googletag && window.googletag.apiReady) {
                this.gptInitialized = true;
                return resolve();
            }
            if (document.querySelector('script[src*="gpt.js"]')) {
                // If script is already loading, just wait for the command queue
                window.googletag = window.googletag || { cmd: [] };
                window.googletag.cmd.push(() => {
                    this.gptInitialized = true;
                    resolve();
                });
                return;
            }
            const script = document.createElement('script');
            script.async = true;
            script.src = 'https://securepubads.g.doubleclick.net/tag/js/gpt.js';
            script.crossOrigin = 'anonymous';
            script.onload = () => {
                window.googletag = window.googletag || { cmd: [] };
                window.googletag.cmd.push(() => {
                    this.gptInitialized = true;
                    resolve();
                });
            };
            script.onerror = reject;
            document.head.appendChild(script);
        });
    }

    async showLeftMarginAd() {
        if (window.innerWidth <= 768) {
            console.log('On a mobile device, not showing left margin ad.');
            return;
        }
        
        if (!this.leftMarginAdSlot) {
            console.error('Left margin ad slot is not available. Cannot show ad.');
            return;
        }

        console.log('Requesting and preparing left margin GPT ad...');
        
        // Hide the container until we know an ad has rendered
        this.leftMarginAdContainer.style.display = 'none';

        window.googletag.cmd.push(() => {
            // Listen for when the ad slot is finished rendering
            googletag.pubads().addEventListener('slotRenderEnded', (event) => {
                // Check if the event is for our specific ad slot
                if (event.slot === this.leftMarginAdSlot) {
                    if (!event.isEmpty) {
                        console.log('GPT ad has rendered, showing container.');
                        this.leftMarginAdContainer.style.display = 'block';
                    } else {
                        console.log('GPT ad slot was empty, container remains hidden.');
                    }
                }
            });

            // Now, refresh the ad slot to trigger the request
            googletag.pubads().refresh([this.leftMarginAdSlot]);
        });
    }

    hideLeftMarginAd() {
        console.log('Hiding left margin GPT ad.');
        this.leftMarginAdContainer.style.display = 'none';

        window.googletag.cmd.push(() => {
            // Clear the ad content from the slot without destroying it
            googletag.pubads().clear([this.leftMarginAdSlot]);
        });
    }

    bindEvents() {
        // Carousel navigation
        this.carouselPrev.addEventListener('click', () => this.scrollCarousel('prev'));
        this.carouselNext.addEventListener('click', () => this.scrollCarousel('next'));
        
        this.carousel.addEventListener('click', (e) => {
            const videoItem = e.target.closest('.video-item');
            if (videoItem) {
                const index = parseInt(videoItem.dataset.index);
                this.openFullscreen(index);
            }
        });

        // Fullscreen navigation
        this.prevBtn.addEventListener('click', () => this.previousVideo());
        this.nextBtn.addEventListener('click', () => this.nextVideo());
        this.closeBtn.addEventListener('click', () => this.closeFullscreen());

        // Keyboard navigation
        document.addEventListener('keydown', this.handleKeyboard.bind(this));

        // Touch events for swipe
        this.fullscreenModal.addEventListener('touchstart', this.handleTouchStart.bind(this), { passive: true });
        this.fullscreenModal.addEventListener('touchend', this.handleTouchEnd.bind(this), { passive: true });

        // Carousel scrolling is now handled by the simplified navigation logic.
        // The handleCarouselScroll function is no longer needed.
    }

    // The handleCarouselScroll function has been removed as it's no longer necessary
    // with the simplified looping logic. The carousel navigation buttons and
    // autoplay feature now handle all movement.

    async loadSampleVideos() {
        console.log('loadSampleVideos called');
        this.showLoading();
        
        try {
            console.log('Fetching MRSS playlist...');
            const videos = await this.fetchMRSSPlaylist();
            console.log('MRSS playlist loaded:', videos);
            this.playlist = videos;
            this.renderCarousel();
        } catch (error) {
            console.error('Error loading MRSS playlist:', error);
            // Fallback to sample videos if MRSS fails
            console.log('Loading fallback videos...');
            this.loadFallbackVideos();
        } finally {
            this.hideLoading();
        }
    }

    showLoading() {
        this.carousel.innerHTML = `
            <div class="loading-container">
                <div class="loading"></div>
                <p>Loading videos from playlist...</p>
            </div>
        `;
    }

    hideLoading() {
        // Loading will be replaced when renderCarousel() is called
    }

    async fetchMRSSPlaylist() {
        const mrssUrl = 'https://cdn.jwplayer.com/v2/playlists/OEhQJBq1?format=mrss';
        const response = await fetch(mrssUrl);
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const xmlText = await response.text();
        return this.parseMRSSFeed(xmlText);
    }

    parseMRSSFeed(xmlText) {
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(xmlText, 'text/xml');
        
        // Check for parsing errors
        const parseError = xmlDoc.querySelector('parsererror');
        if (parseError) {
            throw new Error('Failed to parse MRSS XML');
        }
        
        const videos = [];
        const items = xmlDoc.querySelectorAll('item');
        
        items.forEach(item => {
            const title = item.querySelector('title')?.textContent?.trim() || 'Untitled Video';
            const mediaContent = item.querySelector('media\\:content, content');
            const mediaThumbnail = item.querySelector('media\\:thumbnail, thumbnail');
            
            if (mediaContent) {
                const url = mediaContent.getAttribute('url');
                if (url) {
                    // Extract video ID from URL
                    const videoId = this.extractVideoId(url);
                    const src = `https://cdn.jwplayer.com/videos/${videoId}-3uG5rpkd.mp4`;
                    
                    // Extract duration from media:content if available
                    const duration = mediaContent.getAttribute('duration') || '00:00';
                    
                    videos.push({
                        src: src,
                        title: title,
                        duration: this.formatDuration(duration),
                        thumbnail: mediaThumbnail?.getAttribute('url') || ''
                    });
                }
            }
        });
        
        if (videos.length === 0) {
            throw new Error('No videos found in MRSS feed');
        }
        
        return videos;
    }

    extractVideoId(url) {
        // Handle different URL formats
        const urlParts = url.split('/');
        const lastPart = urlParts[urlParts.length - 1];
        
        // Remove file extension and any additional parameters
        const videoId = lastPart.split('.')[0].split('-')[0];
        
        return videoId;
    }

    formatDuration(seconds) {
        if (typeof seconds === 'string' && seconds.includes(':')) {
            return seconds;
        }
        
        const totalSeconds = parseInt(seconds) || 0;
        const minutes = Math.floor(totalSeconds / 60);
        const remainingSeconds = totalSeconds % 60;
        
        return `${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
    }

    formatTime(seconds) {
        const minutes = Math.floor(seconds / 60);
        const remainingSeconds = Math.floor(seconds % 60);
        return `${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
    }

    parseDuration(durationString) {
        if (!durationString) return 0;
        
        const parts = durationString.split(':');
        if (parts.length === 2) {
            return parseInt(parts[0]) * 60 + parseInt(parts[1]);
        } else if (parts.length === 3) {
            return parseInt(parts[0]) * 3600 + parseInt(parts[1]) * 60 + parseInt(parts[2]);
        }
        return 0;
    }

    loadFallbackVideos() {
        const fallbackVideos = [
            {
                src: 'https://cdn.jwplayer.com/videos/rZAXpIYw-3uG5rpkd.mp4',
                title: 'Jetski',
                duration: '00:04'
            },
            {
                src: 'https://cdn.jwplayer.com/videos/XVrlue0I-3uG5rpkd.mp4',
                title: 'Jellyfish',
                duration: '00:54'
            },
            {
                src: 'https://cdn.jwplayer.com/videos/1bOLIy6G-3uG5rpkd.mp4',
                title: 'Hiking',
                duration: '00:21'
            },
            {
                src: 'https://cdn.jwplayer.com/videos/1bOLIy6G-3uG5rpkd.mp4',
                title: 'Hiking 2',
                duration: '00:21'
            },
            {
                src: 'https://cdn.jwplayer.com/videos/rZAXpIYw-3uG5rpkd.mp4',
                title: 'Jetski 2',
                duration: '00:04'
            },
            {
                src: 'https://cdn.jwplayer.com/videos/XVrlue0I-3uG5rpkd.mp4',
                title: 'Jellyfish 2',
                duration: '00:54'
            },
            {
                src: 'https://cdn.jwplayer.com/videos/1bOLIy6G-3uG5rpkd.mp4',
                title: 'Hiking 3',
                duration: '00:21'
            },
            {
                src: 'https://cdn.jwplayer.com/videos/rZAXpIYw-3uG5rpkd.mp4',
                title: 'Jetski 3',
                duration: '00:04'
            },
            {
                src: 'https://cdn.jwplayer.com/videos/XVrlue0I-3uG5rpkd.mp4',
                title: 'Jellyfish 3',
                duration: '00:54'
            },
            {
                src: 'https://cdn.jwplayer.com/videos/1bOLIy6G-3uG5rpkd.mp4',
                title: 'Hiking 4',
                duration: '00:21'
            }
        ];

        this.playlist = fallbackVideos;
        this.renderCarousel();
    }

    async refreshPlaylist() {
        this.showLoading();
        try {
            const videos = await this.fetchMRSSPlaylist();
            this.playlist = videos;
            this.renderCarousel();
            this.showMessage('Playlist refreshed successfully!', 'success');
        } catch (error) {
            console.error('Error refreshing playlist:', error);
            this.showMessage('Failed to refresh playlist. Using fallback videos.', 'error');
            this.loadFallbackVideos();
        } finally {
            this.hideLoading();
        }
    }

    showMessage(message, type = 'info') {
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${type}`;
        messageDiv.textContent = message;
        
        // Add to page
        document.body.appendChild(messageDiv);
        
        // Remove after 3 seconds
        setTimeout(() => {
            if (messageDiv.parentNode) {
                messageDiv.parentNode.removeChild(messageDiv);
            }
        }, 3000);
    }

    disableKeyboardControls() {
        // Store original event listener to restore later
        this.originalKeyboardHandler = this.handleKeyboard.bind(this);
        
        // Remove keyboard event listener during ad
        document.removeEventListener('keydown', this.originalKeyboardHandler);
    }

    enableKeyboardControls() {
        // Restore keyboard event listener after ad
        if (this.originalKeyboardHandler) {
            document.addEventListener('keydown', this.originalKeyboardHandler);
        }
    }

    renderCarousel() {
        console.log('renderCarousel called with playlist:', this.playlist);
        
        this.carousel.innerHTML = ''; // Clear previous items.

        const fragment = document.createDocumentFragment();
        let itemIndex = 0;
        
        this.playlist.forEach((video, videoIndex) => {
            const videoItem = this.createVideoItem(video, itemIndex, videoIndex);
            fragment.appendChild(videoItem);
            itemIndex++;
            
            if ((videoIndex === 2 && this.playlist.length > 3) || (videoIndex === 6 && this.playlist.length > 7)) {
                const adItem = this.createCarouselStaticDisplayAdItem(itemIndex);
                fragment.appendChild(adItem);
                itemIndex++; 
            }
        });
        
        this.carousel.appendChild(fragment);
        this.realItemCount = this.carousel.children.length; // Set the correct count of real items.
        console.log('Carousel rendered with', this.realItemCount, 'real items.');
        
        // Setup IntersectionObserver for lazy video playback readiness
        this.setupIntersectionObserver();

        this.updateCarouselNav();
        
        if (this.realItemCount > 0) {
            this.currentIndex = 0;
            this.updateActiveVideo();
            
            setTimeout(() => {
                this.scrollToActiveVideo();
                this.startAutoplay();
            }, 200);
        }
    }

    setupIntersectionObserver() {
        if (this.intersectionObserver) {
            this.intersectionObserver.disconnect();
        }
        const options = { root: this.carousel, rootMargin: '200px', threshold: 0.01 };
        this.intersectionObserver = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    const video = entry.target.querySelector('video');
                    if (video) {
                        // Switch to auto metadata loading when near viewport
                        video.preload = 'metadata';
                    }
                    this.intersectionObserver.unobserve(entry.target);
                }
            });
        }, options);

        this.carousel.querySelectorAll('.video-item').forEach(item => {
            if (!item.dataset.type) {
                this.intersectionObserver.observe(item);
            }
        });
    }

    updateCarouselNav() {
        // For infinite scroll, we never disable the navigation buttons
        this.carouselPrev.disabled = false;
        this.carouselNext.disabled = false;
    }

    createVideoItem(video, itemIndex, videoIndex) {
        const videoItem = document.createElement('div');
        videoItem.className = 'video-item';
        videoItem.dataset.index = itemIndex; // This is the unique index in the carousel
        videoItem.dataset.videoIndex = videoIndex; // This maps back to the playlist
        
        videoItem.innerHTML = `
            <video muted>
                <source src="${video.src}" type="video/mp4">
                Your browser does not support the video tag.
            </video>
            <div class="video-info">
                <div class="video-title">${video.title}</div>
                <div class="video-duration">
                    <span class="duration-display">${video.duration}</span>
                    <span class="countdown-timer" style="display: none;">00:00</span>
                </div>
            </div>
        `;
        
        const videoElement = videoItem.querySelector('video');
        const durationDisplay = videoItem.querySelector('.duration-display');
        const countdownTimer = videoItem.querySelector('.countdown-timer');
        
        // Store original duration for countdown calculation
        const originalDuration = this.parseDuration(video.duration);
        
        // Add timeupdate event listener for countdown
        videoElement.addEventListener('timeupdate', () => {
            if (videoElement.paused) {
                // Show original duration when paused
                durationDisplay.style.display = 'inline';
                countdownTimer.style.display = 'none';
            } else {
                // Show countdown when playing
                const remainingTime = Math.max(0, originalDuration - videoElement.currentTime);
                const countdownText = this.formatTime(remainingTime);
                
                durationDisplay.style.display = 'none';
                countdownTimer.style.display = 'inline';
                countdownTimer.textContent = countdownText;
            }
        });
        
        // Reset countdown when video ends or is reset
        videoElement.addEventListener('ended', () => {
            durationDisplay.style.display = 'inline';
            countdownTimer.style.display = 'none';
        });
        
        // Add click event to open fullscreen and set as active
        videoItem.addEventListener('click', () => {
            console.log(`Video item clicked for index: ${itemIndex}`);
            this.setActiveVideo(itemIndex);
            this.openFullscreen(itemIndex);
        });
        
        // Preload video for better performance
        videoElement.preload = 'metadata';
        
        return videoItem;
    }

    createCarouselStaticDisplayAdItem(index) {
        const adItem = document.createElement('div');
        adItem.className = 'video-item carousel-static-display-ad-item';
        adItem.dataset.index = index;
        adItem.dataset.type = 'carousel-static-display-ad';
        
        adItem.innerHTML = `
            <div class="carousel-static-display-ad-content">
                <div class="carousel-static-display-ad-title">Advertisement</div>
                <div class="carousel-static-display-ad-image">
                    <img src="https://images.pexels.com/photos/4109120/pexels-photo-4109120.jpeg" alt="Advertisement">
                </div>
            </div>
            <div class="video-info">
                <div class="video-title">Advertisement</div>
                <div class="video-duration">
                    <span class="duration-display">00:02</span>
                    <span class="countdown-timer" style="display: none;">00:00</span>
                </div>
            </div>
        `;
        
        const durationDisplay = adItem.querySelector('.duration-display');
        const countdownTimer = adItem.querySelector('.countdown-timer');
        
        // Add click event to open Coca-Cola website in new tab
        adItem.addEventListener('click', () => {
            console.log(`Carousel static display ad item clicked for index: ${index}`);
            window.open('https://www.coca-cola.com/us/en', '_blank');
        });
        
        return adItem;
    }

    playCarouselStaticDisplayAd(adItem) {
        console.log('Playing carousel static display ad for 2 seconds');
        
        const durationDisplay = adItem.querySelector('.duration-display');
        const countdownTimer = adItem.querySelector('.countdown-timer');
        
        // Show countdown timer
        durationDisplay.style.display = 'none';
        countdownTimer.style.display = 'inline';
        
        // Set initial countdown time (2 seconds)
        let remainingTime = 2;
        countdownTimer.textContent = this.formatTime(remainingTime);
        
        // Start countdown timer
        const countdownInterval = setInterval(() => {
            // *** FIX: If the user has started scrolling, cancel this ad's timer. ***
            if (this.isManuallyScrolling) {
                console.log('User started scrolling during ad countdown. Clearing interval.');
                clearInterval(countdownInterval);
                return;
            }

            remainingTime--;
            countdownTimer.textContent = this.formatTime(remainingTime);
            
            if (remainingTime <= 0) {
                clearInterval(countdownInterval);
                console.log('Carousel static display ad finished, advancing to next slide');
                this.advanceToNextSlide();
            }
        }, 1000);
        
        // Store the interval so we can clear it if needed
        this.currentAdCountdownInterval = countdownInterval;
    }

    openFullScreenVerticalDisplayAd(index) {
        console.log('🚀 OPENING FULL SCREEN VERTICAL DISPLAY AD for index:', index);
        
        // Hide the video element
        this.fullscreenVideo.style.display = 'none';
        
        // Show the fullscreen modal
        this.fullscreenModal.classList.add('active');
        document.body.style.overflow = 'hidden';
        
        console.log('Fullscreen modal should now be visible');
        console.log('Fullscreen modal classes:', this.fullscreenModal.className);
        
        // Use pre-created ad content for better performance
        if (!this.fullscreenAdContent) {
            this.fullscreenAdContent = document.createElement('div');
            this.fullscreenAdContent.className = 'full-screen-vertical-display-ad-content';
            this.fullscreenAdContent.innerHTML = `
                <div class="full-screen-vertical-display-ad-title">Advertisement</div>
                <div class="full-screen-vertical-display-ad-image">
                    <img src="https://images.pexels.com/photos/4109120/pexels-photo-4109120.jpeg" alt="Advertisement" preload="auto">
                </div>
                <div class="full-screen-vertical-display-ad-countdown">2</div>
            `;
            
            // Add click event to open Coca-Cola website
            this.fullscreenAdContent.addEventListener('click', () => {
                window.open('https://www.coca-cola.com/us/en', '_blank');
            });
        }
        
        // Clear existing content and add pre-created ad
        const container = this.fullscreenModal.querySelector('.fullscreen-container');
        console.log('Fullscreen container found:', container);
        container.innerHTML = '';
        container.appendChild(this.fullscreenAdContent);
        console.log('Ad content added to container');
        
        // Force the ad content to be visible and properly sized
        this.fullscreenAdContent.style.display = 'flex';
        this.fullscreenAdContent.style.opacity = '1';
        this.fullscreenAdContent.style.visibility = 'visible';
        this.fullscreenAdContent.style.width = 'auto';
        this.fullscreenAdContent.style.height = 'auto';
        this.fullscreenAdContent.style.maxWidth = '100%';
        this.fullscreenAdContent.style.maxHeight = '100%';
        console.log('Ad content styles applied:', this.fullscreenAdContent.style.display, this.fullscreenAdContent.style.opacity);
        console.log('Container children count:', container.children.length);
        console.log('Ad content HTML:', this.fullscreenAdContent.outerHTML);
        console.log('Fullscreen modal display:', this.fullscreenModal.style.display);
        console.log('Fullscreen modal classes:', this.fullscreenModal.className);
        
        // Reset countdown display
        const countdownElement = this.fullscreenAdContent.querySelector('.full-screen-vertical-display-ad-countdown');
        countdownElement.textContent = '2';
        
        // Start countdown timer (2 seconds for fullscreen)
        let countdown = 2;
        
        const countdownInterval = setInterval(() => {
            countdown--;
            countdownElement.textContent = countdown;
            
            if (countdown <= 0) {
                clearInterval(countdownInterval);
                console.log('Full screen vertical display ad finished');
                
                // 1. Manually advance to the next video index, skipping ads
                const totalItems = this.carousel.children.length;
                let nextIndex = (this.currentIndex + 1) % totalItems;
                while (this.carousel.querySelector(`[data-index="${nextIndex}"]`).dataset.type === 'carousel-static-display-ad') {
                    nextIndex = (nextIndex + 1) % totalItems;
                }
                this.currentIndex = nextIndex;

                // 2. Get the correct video object from the playlist
                const nextCarouselItem = this.carousel.querySelector(`[data-index="${this.currentIndex}"]`);
                const nextVideoIndexInPlaylist = parseInt(nextCarouselItem.dataset.videoIndex, 10);
                const nextVideo = this.playlist[nextVideoIndexInPlaylist];
                
                if (!nextVideo) {
                    console.error('No next video found after ad');
                    this.closeFullscreen();
                    return;
                }
                
                // 3. Restore the UI
                const container = this.fullscreenModal.querySelector('.fullscreen-container');
                container.innerHTML = `
                    <div class="video-wrapper">
                        <video id="fullscreenVideo" controls>
                            Your browser does not support the video tag.
                        </video>
                    </div>
                    <button class="control-btn prev-btn" id="prevBtn">↑</button>
                    <button class="control-btn next-btn" id="nextBtn">↓</button>
                `;
                
                // 4. Re-bind elements and event listeners
                this.fullscreenVideo = this.fullscreenModal.querySelector('#fullscreenVideo');
                this.prevBtn = this.fullscreenModal.querySelector('#prevBtn');
                this.nextBtn = this.fullscreenModal.querySelector('#nextBtn');
                this.prevBtn.addEventListener('click', () => this.previousVideo());
                this.nextBtn.addEventListener('click', () => this.nextVideo());
                this.fullscreenVideo.removeEventListener('ended', this.fullscreenVideoEndedHandler);
                this.fullscreenVideo.addEventListener('ended', this.fullscreenVideoEndedHandler);
                
                // 5. Load and play the correct next video
                this.fullscreenVideo.src = nextVideo.src;
                this.playVideo(this.fullscreenVideo);
                
                // 6. Update the carousel's active state
                this.updateActiveVideo();
            }
        }, 1000);
        
        // Store the interval so we can clear it if needed
        this.currentFullscreenAdCountdownInterval = countdownInterval;
        
        // Update active state
        this.updateActiveVideo();
    }

    preloadAdImage() {
        // Preload the ad image for better performance
        const img = new Image();
        img.src = 'https://images.pexels.com/photos/4109120/pexels-photo-4109120.jpeg';
        this.preloadedAdImage = img;
    }

    getVideoIndexInPlaylist(carouselIndex) {
        // Calculate which video in the original playlist this carousel index corresponds to
        let videoCount = 0;
        let adCount = 0;
        
        for (let i = 0; i <= carouselIndex; i++) {
            const item = this.carousel.querySelector(`[data-index="${i}"]`);
            if (item && item.dataset.type === 'carousel-static-display-ad') {
                adCount++;
                console.log(`Item ${i} is a carousel static display ad`);
            } else {
                videoCount++;
                console.log(`Item ${i} is a video (count: ${videoCount})`);
            }
        }
        
        console.log(`Carousel index ${carouselIndex} corresponds to video ${videoCount} in playlist`);
        return videoCount;
    }

    // Helper method to check if an index should show an ad




    activateCenteredVideo() {
        // Cache DOM queries for better performance
        const carouselRect = this.carousel.getBoundingClientRect();
        const carouselCenter = carouselRect.left + carouselRect.width / 2;
        
        let closestItem = null;
        let closestDistance = Infinity;
        
        // Use more efficient query selector and cache the result
        const videoItems = this.carousel.querySelectorAll('.video-item');
        const itemsArray = Array.from(videoItems); // Convert to array for better performance
        
        for (let i = 0; i < itemsArray.length; i++) {
            const item = itemsArray[i];
            const itemRect = item.getBoundingClientRect();
            const itemCenter = itemRect.left + itemRect.width / 2;
            const distance = Math.abs(itemCenter - carouselCenter);
            
            if (distance < closestDistance) {
                closestDistance = distance;
                closestItem = item;
            }
        }
        
        if (closestItem) {
            const newIndex = parseInt(closestItem.dataset.index);
            
            // Only update if index actually changed
            if (newIndex !== this.currentIndex) {
                console.log('Activating centered video at index:', newIndex);
                
                // Pause current video
                this.pauseCurrentVideo();
                
                // Set new active index
                this.currentIndex = newIndex;
                
                // Play the centered video
                this.playCurrentVideo();
            }
        }
        return closestItem; // Return the item that was activated
    }

    handleKeyboard(e) {
        // Only handle keyboard events when in fullscreen mode
        if (!this.isFullscreen) return;
        
        // Prevent default behavior for navigation keys to avoid carousel movement
        if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(e.key)) {
            e.preventDefault();
        }
        
        switch (e.key) {
            case 'ArrowUp':
                this.previousVideo();
                break;
            case 'ArrowDown':
                this.nextVideo();
                break;
            case ' ':
                this.togglePlayPause();
                break;
        }
    }

    togglePlayPause() {
        if (this.isFullscreen && this.fullscreenVideo) {
            if (this.fullscreenVideo.paused) {
                this.playVideo(this.fullscreenVideo);
            } else {
                this.fullscreenVideo.pause();
            }
        }
    }

    nextVideo() {
        if (this.realItemCount === 0) return;
        
        // In fullscreen, check for ads first before advancing the index.
        if (this.isFullscreen) {
            this.fullscreenVideosWatched++;
            console.log(`Manually navigated to next video. Counter: ${this.fullscreenVideosWatched}`);
            
        if (this.fullscreenVideosWatched === 1) {
            console.log(`🎬 SHOWING IMA VIDEO AD after video ${this.fullscreenVideosWatched}`);
            this.playVideoAd();
            return;
        }
        
        if (this.fullscreenVideosWatched === 4 || this.fullscreenVideosWatched === 8) {
            console.log(`🎯 SHOWING FULL SCREEN VERTICAL DISPLAY AD after video ${this.fullscreenVideosWatched}`);
            this.openFullScreenVerticalDisplayAd(this.currentIndex);
            return;
        }
        }
        
        // Use modulo for clean, infinite looping.
        this.currentIndex = (this.currentIndex + 1) % this.realItemCount;
        this.loadVideoInFullscreen();
    }

    previousVideo() {
        if (this.realItemCount === 0) return;
        
        // Use modulo for clean, infinite looping in reverse.
        this.currentIndex = (this.currentIndex - 1 + this.realItemCount) % this.realItemCount;
        
        let prevItem = this.carousel.querySelector(`[data-index="${this.currentIndex}"]`);
        while (prevItem && prevItem.dataset.type === 'carousel-static-display-ad') {
            this.currentIndex = (this.currentIndex - 1 + this.realItemCount) % this.realItemCount;
            prevItem = this.carousel.querySelector(`[data-index="${this.currentIndex}"]`);
        }
        
        this.loadVideoInFullscreen();
    }

    scrollCarousel(direction) {
        // Pause autoplay when user manually navigates
        this.pauseAutoplay();
        this.isManuallyScrolling = true;
        
        if (direction === 'next') {
            this.currentIndex = (this.currentIndex + 1) % this.realItemCount;
        } else {
            this.currentIndex = (this.currentIndex - 1 + this.realItemCount) % this.realItemCount;
        }
        
        // After calculating the correct index, play the corresponding video/ad.
        // This will also handle scrolling the item into view.
        this.playCurrentVideo();
        // Allow auto actions again shortly after programmatic scroll completes
        setTimeout(() => { this.isManuallyScrolling = false; }, 400);
    }

    playCurrentVideo() {
        console.log('playCurrentVideo called for index:', this.currentIndex);
        
        this.pauseAllVideos();
        
        // Check if carousel has been rendered
        if (!this.carousel.children.length) {
            console.log('Carousel not yet rendered, skipping play');
            return;
        }
        
        const currentItem = this.carousel.querySelector(`[data-index="${this.currentIndex}"]`);
        
        // Check if current item is a carousel static display ad
        if (currentItem && currentItem.dataset.type === 'carousel-static-display-ad') {
            console.log('Current item is a carousel static display ad, showing for 2 seconds');
            this.playCarouselStaticDisplayAd(currentItem);
        } else {
            console.log('Current item is a video, playing');
            // Get the video element from the current item
            const currentVideo = currentItem ? currentItem.querySelector('video') : null;
            if (currentVideo && currentVideo.readyState >= 1) {
                console.log('Found video element, setting up event listeners');
                
                // *** FIX: Remove the listener from the *previous* video first. ***
                if (this.lastPlayedVideo) {
                    this.lastPlayedVideo.removeEventListener('ended', this.videoEndedHandler);
                }
                
                // Add the stable 'ended' event listener for this specific video.
                currentVideo.addEventListener('ended', this.videoEndedHandler);
                this.lastPlayedVideo = currentVideo; // Remember this video for the next cleanup.
                
                // Add more event listeners for debugging
                currentVideo.addEventListener('loadstart', () => console.log('Video loadstart'));
                currentVideo.addEventListener('loadeddata', () => {
                    console.log('Video loadeddata, duration:', currentVideo.duration);
                });
                currentVideo.addEventListener('canplay', () => console.log('Video canplay'));
                currentVideo.addEventListener('play', () => console.log('Video play'));
                currentVideo.addEventListener('pause', () => console.log('Video pause'));
                currentVideo.addEventListener('ended', () => console.log('Video ended'));
                currentVideo.addEventListener('timeupdate', () => {
                    if (currentVideo.currentTime > 0) {
                        console.log('Video timeupdate:', currentVideo.currentTime, '/', currentVideo.duration);
                    }
                });
                
                console.log('Attempting to play video');
                this.playVideo(currentVideo);
            } else {
                console.error('No video element found for index:', this.currentIndex);
                // If no video found, advance to next slide
                console.log('Advancing to next slide due to missing video');
                setTimeout(() => {
                    this.advanceToNextSlide();
                }, 100);
            }
        }
        
        this.updateActiveVideo();
        this.scrollToActiveVideo();
    }

    advanceToNextSlide() {
        if (this.isManuallyScrolling) {
            console.log('User is manually scrolling. Aborting auto-advance.');
            return;
        }

        console.log('Advancing to next slide from index:', this.currentIndex);
        
        if (this.currentAdCountdownInterval) {
            clearInterval(this.currentAdCountdownInterval);
            this.currentAdCountdownInterval = null;
        }
        
        this.pauseCurrentVideo();
        
        // Use modulo for clean, infinite looping.
        this.currentIndex = (this.currentIndex + 1) % this.realItemCount;
        console.log('Moved to index:', this.currentIndex);
        
        this.playCurrentVideo();
    }

    updateActiveVideo() {
        const videoItems = this.carousel.querySelectorAll('.video-item');
        
        // Remove active class from all items
        videoItems.forEach((item) => {
            item.classList.remove('active');
        });
        
        // Add active class to current item
        const currentItem = this.carousel.querySelector(`[data-index="${this.currentIndex}"]`);
        if (currentItem) {
            currentItem.classList.add('active');
        }
        
        // Always scroll to center the active item (video or ad)
        if (!this.isFullscreen) {
            this.scrollToActiveVideo();
        }
        
        // Update carousel navigation state
        this.updateCarouselNav();
    }

    scrollToActiveVideo() {
            const activeItem = this.carousel.querySelector('.video-item.active');
            if (activeItem) {
            // Mark as programmatic scroll to prevent infinite loop
            this.isProgrammaticScroll = true;
            
                // Calculate the position to center the active video
                const carouselRect = this.carousel.getBoundingClientRect();
                const itemRect = activeItem.getBoundingClientRect();
                const itemCenter = itemRect.left + itemRect.width / 2;
                const carouselCenter = carouselRect.left + carouselRect.width / 2;
                const scrollOffset = itemCenter - carouselCenter;
                
                // Smooth scroll to center the active video
                this.carousel.scrollTo({
                    left: this.carousel.scrollLeft + scrollOffset,
                    behavior: 'smooth'
                });
            
            // Reset programmatic scroll flag after animation
            setTimeout(() => {
                this.isProgrammaticScroll = false;
            }, 300);
            }
    }

    setActiveVideo(index) {
        console.log('setActiveVideo called for index:', index);
        
        // Pause all videos
        const videos = this.carousel.querySelectorAll('video');
        videos.forEach(video => {
            video.pause();
            video.currentTime = 0;
        });
        
        // Set new active index
        this.currentIndex = index;
        
        // Play the selected video
        this.playCurrentVideo();
        this.scrollToActiveVideo();
        
        // Pause autoplay when user manually selects a video
        this.pauseAutoplay();
    }

    pauseCurrentVideo() {
        const currentItem = this.carousel.querySelector(`[data-index="${this.currentIndex}"]`);
        const currentVideo = currentItem ? currentItem.querySelector('video') : null;
        
        if (currentVideo) {
            currentVideo.pause();
            currentVideo.currentTime = 0;

            // *** FIX: Crucially, remove the ended listener when we pause. ***
            // This prevents a paused video from auto-advancing later.
            currentVideo.removeEventListener('ended', this.videoEndedHandler);
        }
    }

    pauseAllVideos() {
        document.querySelectorAll('video').forEach(v => v.pause());
    }

    pauseAllCarouselVideos() {
        const allVideos = this.carousel.querySelectorAll('video');
        allVideos.forEach(video => {
            video.pause();
            video.currentTime = 0;
        });
    }

    pauseAutoplay() {
        if (this.autoplayInterval) {
            clearInterval(this.autoplayInterval);
            this.autoplayInterval = null;
        }
        
        // Also clear any active ad countdown, as this is part of the autoplay logic.
        if (this.currentAdCountdownInterval) {
            clearInterval(this.currentAdCountdownInterval);
            this.currentAdCountdownInterval = null;
        }
    }

    resumeAutoplay() {
        if (!this.autoplayInterval && !this.isFullscreen) {
            this.startAutoplay();
        }
    }

    restartAutoplayWithDelay() {
        // Restart autoplay after 10 seconds of inactivity
        setTimeout(() => {
            if (!this.isFullscreen && !this.autoplayInterval) {
                this.startAutoplay();
            }
        }, 10000);
    }

    startAutoplay() {
        console.log('startAutoplay called');
        
        if (this.autoplayInterval) {
            clearInterval(this.autoplayInterval);
        }
        
        // Start with the first video
        this.currentIndex = 0;
        console.log('Starting with index 0');
        
        this.playCurrentVideo();
        
        // Ensure the first video is centered and focused
        setTimeout(() => {
            this.scrollToActiveVideo();
        }, 200);
    }

    openFullscreen(index) {
        console.log(`Opening fullscreen for index: ${index}`);
        this.currentIndex = index;
        this.isFullscreen = true;

        // Start fullscreen video counter at 0 when entering fullscreen
        this.fullscreenVideosWatched = 0;

        // Pause carousel autoplay and stop all carousel videos
        this.pauseAutoplay();
        this.pauseAllCarouselVideos();
        
        // Find the clicked item in the carousel to get its type and videoIndex.
        const currentItem = this.carousel.querySelector(`[data-index="${index}"]`);
        
        if (!currentItem) {
            console.error(`Could not find carousel item with index ${index}.`);
            this.closeFullscreen();
            return;
        }

        // Check if current item is a carousel static display ad
        if (currentItem.dataset.type === 'carousel-static-display-ad') {
            console.log('Carousel static display ad clicked - opening Coca-Cola website');
            window.open('https://www.coca-cola.com/us/en', '_blank');
            this.closeFullscreen();
            return;
        }
        
        // Ensure video element is visible
        this.fullscreenVideo.style.display = 'block';
        
        // Use the video-index to get the correct video from the playlist.
        const videoIndex = parseInt(currentItem.dataset.videoIndex);
        if (isNaN(videoIndex) || videoIndex < 0 || videoIndex >= this.playlist.length) {
            console.error(`Invalid video index ${videoIndex} for carousel item ${index}.`);
            this.closeFullscreen();
            return;
        }
        
        const video = this.playlist[videoIndex];
        if (!video) {
            console.error(`Video not found in playlist at index: ${videoIndex}`);
            this.closeFullscreen();
            return;
        }

        console.log(`Loading video: ${video.title} from ${video.src}`);
        
        // Load video and show fullscreen
        this.fullscreenVideo.src = video.src;
        this.fullscreenModal.classList.add('active');
        document.body.style.overflow = 'hidden';
        
        this.pauseAllVideos();
        
        // Ensure video is visible and properly sized
        this.fullscreenVideo.style.display = 'block';
        this.fullscreenVideo.style.width = 'auto';
        this.fullscreenVideo.style.height = 'auto';
        this.fullscreenVideo.style.maxWidth = '100%';
        this.fullscreenVideo.style.maxHeight = '100%';
        this.fullscreenVideo.style.opacity = '1';
        
        // Add loaded class when video can play
        this.fullscreenVideo.addEventListener('loadeddata', () => {
            console.log('Video loaded, adding loaded class');
            this.fullscreenVideo.classList.add('loaded');
        });
        
        // Update active state
        this.updateActiveVideo();
        

        
        // Ensure video is visible
        setTimeout(() => {
            console.log('Ensuring video is visible...');
            this.fullscreenVideo.style.display = 'block';
            this.fullscreenVideo.style.opacity = '1';
            console.log('Video element:', this.fullscreenVideo);
        }, 100);
        
        // Play the video
        console.log('Playing video directly');
        console.log('Index:', index);
        this.playVideo(this.fullscreenVideo);
        
        // Add ended event listener for auto-progression
        this.fullscreenVideo.removeEventListener('ended', this.fullscreenVideoEndedHandler); // Remove first to prevent duplicates
        this.fullscreenVideo.addEventListener('ended', this.fullscreenVideoEndedHandler);
        
        // Lazy-init GPT on first fullscreen use, then show the left margin ad
        if (!this.gptInitialized) {
            this.initializeLeftMarginAd().then(() => this.showLeftMarginAd());
        } else {
            this.showLeftMarginAd();
        }

        console.log('Fullscreen opened successfully');
    }

    closeFullscreen() {
        if (!this.isFullscreen) return;

        this.pauseAllVideos();

        // Destroy any active IMA ad before closing
        this.destroyIMAAd();

        // Clear any active placeholder ad countdown
        if (this.currentVideoAdCountdownInterval) {
            clearInterval(this.currentVideoAdCountdownInterval);
            this.currentVideoAdCountdownInterval = null;
        }

        // Hide the left margin ad when leaving fullscreen
        this.hideLeftMarginAd();

        this.isFullscreen = false;
        this.fullscreenVideo.pause();
        
        // Remove the ended event listener to prevent background activity
        this.fullscreenVideo.removeEventListener('ended', this.fullscreenVideoEndedHandler);
        
        // Reset video loaded state
        this.fullscreenVideo.classList.remove('loaded');
        
        this.fullscreenModal.classList.remove('active');
        document.body.style.overflow = '';
        
        
        // Show video element again if it was hidden
        this.fullscreenVideo.style.display = 'block';
        
        // Re-enable keyboard controls
        this.enableKeyboardControls();
        
        // Resume carousel autoplay
        this.resumeAutoplay();
        // Reset the fullscreen video counter
        this.fullscreenVideosWatched = 0;
    }

    loadVideoInFullscreen() {
        // Find the current item in the carousel to determine if it's an ad or video.
        const currentItem = this.carousel.querySelector(`[data-index="${this.currentIndex}"]`);
        
        if (!currentItem) {
            console.error(`Could not find carousel item with index ${this.currentIndex} in loadVideoInFullscreen.`);
            // As a fallback, try advancing to the next slide to prevent getting stuck.
            this.nextVideo(); 
            return;
        }
        
        // Check if current item is a carousel static display ad
        if (currentItem.dataset.type === 'carousel-static-display-ad') {
            console.log('Carousel static display ad encountered in fullscreen - skipping');
            // Skip carousel ads in fullscreen and move to next item
            this.currentIndex++;
            const totalItems = this.carousel.children.length;
            if (this.currentIndex >= totalItems) {
                this.currentIndex = 0;
            }
            // Recursively call this method to load the next item
            this.loadVideoInFullscreen();
        } else {
            // It's a video. Get the videoIndex from the data attribute.
            const videoIndex = parseInt(currentItem.dataset.videoIndex);
             if (isNaN(videoIndex) || videoIndex < 0 || videoIndex >= this.playlist.length) {
                console.error(`Invalid video index ${videoIndex} for carousel item ${this.currentIndex}.`);
                this.nextVideo(); // Try to recover.
                return;
            }

            // Load and play video
            const video = this.playlist[videoIndex];
            if (video) {
                this.fullscreenVideo.style.display = 'block';
                this.fullscreenVideo.src = video.src;
                this.playVideo(this.fullscreenVideo);
                
                // Add ended event listener for auto-progression
                this.fullscreenVideo.removeEventListener('ended', this.fullscreenVideoEndedHandler); // Remove first to prevent duplicates
                this.fullscreenVideo.addEventListener('ended', this.fullscreenVideoEndedHandler);
            }
        }
    }



    handleVideoEndedInCarousel() {
        console.log('Carousel video ended, advancing to next slide.');
        this.advanceToNextSlide();
    }

    handleVideoEndedInFullscreen() {
        console.log('=== FULLSCREEN VIDEO ENDED EVENT TRIGGERED ===');
        // Only handle auto-progression if the current item is a real video
        const currentItem = this.carousel.querySelector(`[data-index="${this.currentIndex}"]`);
        if (currentItem && currentItem.dataset.type === 'carousel-static-display-ad') {
            // Skip ads in fullscreen mode
            this.currentIndex++;
            const totalItems = this.carousel.children.length;
            if (this.currentIndex >= totalItems) {
                this.currentIndex = 0;
            }
            this.loadVideoInFullscreen();
            return;
        }

        // Increment counter after a real video finishes
        this.fullscreenVideosWatched++;
        console.log(`Just finished video ${this.fullscreenVideosWatched} in fullscreen mode`);
        
        // Check if we should show video ad after 1st video
        if (this.fullscreenVideosWatched === 1) {
            console.log(`🎬 SHOWING IMA VIDEO AD after video ${this.fullscreenVideosWatched}`);
            this.playVideoAd();
            return;
        }
        
        // Check if we should show display ad after 4th or 8th video
        if (this.fullscreenVideosWatched === 4 || this.fullscreenVideosWatched === 8) {
            console.log(`🎯 SHOWING FULL SCREEN VERTICAL DISPLAY AD after video ${this.fullscreenVideosWatched}`);
            this.openFullScreenVerticalDisplayAd(this.currentIndex);
            return;
        }
        
        // Auto-progress to next video (skip carousel ads) - only if no ad was shown
        this.advanceToNextVideo();
    }
    
    advanceToNextVideo() {
        const totalItems = this.carousel.children.length;
        let nextIndex = (this.currentIndex + 1) % totalItems;

        // Keep searching for the next video, skipping ads
        while (this.carousel.querySelector(`[data-index="${nextIndex}"]`).dataset.type === 'carousel-static-display-ad') {
            nextIndex = (nextIndex + 1) % totalItems;
        }

        this.currentIndex = nextIndex;
        this.loadVideoInFullscreen();
        this.updateActiveVideo();
    }



    handleTouchStart(e) {
        this.touchStartY = e.touches[0].clientY;
    }

    handleTouchEnd(e) {
        this.touchEndY = e.changedTouches[0].clientY;
        const diffY = this.touchStartY - this.touchEndY;
        const threshold = 50;
        
        if (Math.abs(diffY) > threshold) {
            if (diffY > 0) {
                // Swipe up - next video
                this.nextVideo();
            } else {
                // Swipe down - previous video
                this.previousVideo();
            }
        }
    }

    destroy() {
        // Clear all intervals and timers
        if (this.autoplayInterval) {
            clearInterval(this.autoplayInterval);
        }
        
        // Clear ad countdown intervals
        if (this.currentAdCountdownInterval) {
            clearInterval(this.currentAdCountdownInterval);
        }
        if (this.currentFullscreenAdCountdownInterval) {
            clearInterval(this.currentFullscreenAdCountdownInterval);
        }
        
        // Destroy IMA instance on page unload
        this.destroyIMAAd();

        
        // Remove event listeners
        document.removeEventListener('keydown', this.handleKeyboard.bind(this));
        
        // Pause all videos
        this.pauseAllCarouselVideos();
        if (this.fullscreenVideo) {
            this.fullscreenVideo.pause();
        }
    }
}

// Initialize the video player when the page loads
document.addEventListener('DOMContentLoaded', () => {
    window.videoPlayer = new VerticalVideoPlayer();
});

// Clean up when page unloads
window.addEventListener('beforeunload', () => {
    if (window.videoPlayer) {
        window.videoPlayer.destroy();
    }
}); 