# Vertical Video Player

A modern, responsive vertical video player with carousel autoplay, fullscreen mode, and touch/swipe navigation.

## Features

### 🎥 Video Carousel
- **Autoplay**: Videos automatically cycle through the playlist every 5 seconds
- **Vertical Format**: Optimized for 9:16 aspect ratio videos
- **Smooth Transitions**: Elegant animations and hover effects
- **Active State**: Visual indicator for the currently playing video

### 📱 Fullscreen Mode
- **Click to Open**: Click any video in the carousel to open fullscreen
- **Black Bars**: Videos maintain aspect ratio with black bars on sides
- **Multiple Navigation Options**:
  - Arrow buttons (↑/↓)
  - Keyboard arrow keys (Up/Down)
  - Touch swipe gestures (Up/Down)
  - Spacebar for play/pause

### 🎮 Controls
- **Keyboard Navigation**:
  - `↑` / `↓` Arrow keys: Navigate between videos
  - `Spacebar`: Play/pause current video
  - `Escape`: Close fullscreen mode
- **Touch/Swipe Support**: Swipe up/down to navigate videos
- **Mouse Controls**: Click buttons for navigation

### 🎵 Playlist Management
- **Add Videos**: Add custom videos via URL
- **Clear Playlist**: Remove all videos at once
- **Sample Videos**: Pre-loaded with sample content

## Setup Instructions

1. **Download Files**: Ensure you have all three files in the same directory:
   - `index.html`
   - `styles.css`
   - `script.js`

2. **Open in Browser**: Simply open `index.html` in any modern web browser

3. **Add Your Videos**: 
   - Click "Add Video" button
   - Enter the video URL (supports MP4, WebM, etc.)
   - Add a title and duration
   - Your video will be added to the playlist

```
### Styling Customization
Modify `styles.css` to customize:
- Colors and gradients
- Video aspect ratios
- Animation timings
- Button styles
- Responsive breakpoints

### Autoplay Timing
Change the autoplay interval in `script.js`:
```javascript
this.autoplayInterval = setInterval(() => {
    this.playNextInCarousel();
}, 5000); // Change 5000 to your preferred interval (in milliseconds)
```

## Browser Compatibility

- ✅ Chrome 60+
- ✅ Firefox 55+
- ✅ Safari 12+
- ✅ Edge 79+
- ✅ Mobile browsers (iOS Safari, Chrome Mobile)

## Technical Details

### Video Format Support
- MP4 (H.264)
- WebM
- Ogg
- Any format supported by the HTML5 `<video>` element

### Responsive Design
- Mobile-first approach
- Touch-friendly controls
- Adaptive layouts for different screen sizes

### Performance Features
- Lazy loading of videos
- Efficient memory management
- Smooth 60fps animations
- Reduced motion support for accessibility

## Usage Examples

### Basic Implementation
```html
<!-- Include in your article page -->
<div class="video-carousel" id="videoCarousel">
    <!-- Videos will be populated by JavaScript -->
</div>
```

## Troubleshooting

### Videos Not Playing
- Ensure video URLs are accessible
- Check browser autoplay policies
- Verify video format compatibility

### Touch Gestures Not Working
- Ensure device supports touch events
- Check if touch events are enabled in browser settings

### Fullscreen Not Working
- Some browsers require user interaction before allowing fullscreen
- Ensure videos are loaded before attempting fullscreen

## License

This project is open source and available under the MIT License.

## Contributing

Feel free to submit issues and enhancement requests! 