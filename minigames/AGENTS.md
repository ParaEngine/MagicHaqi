# HTML Page Game Development - AI Agent Instructions

## Project Overview
This repository contains a collection of single-page HTML5 educational games and interactive web applications, primarily designed for the Keepwork platform. All games are self-contained HTML files with embedded CSS and JavaScript.

## Core Architecture Principles

### Single-File Structure
- **Every game is a standalone `.html` or `.md` file**
- Games are organized by type: educational activities, character AI, mini-games, contests
- Obsolete files are moved to `old_obsoleted_files/` directory

### Standard Technology Stack
1. **Tailwind CSS**: Always use CDN version for styling
   ```html
   <script src="https://cdn.keepwork.com/keepwork/cdn/tailwindcss@3.4.16.js"></script>
   ```
2. **No custom CSS/font files** - Use only Tailwind utility classes and inline styles
3. **Three.js** (when needed): Use CDN for 3D games like `guess_cubes.html`
   ```html
   <script src="https://cdnproxy.keepwork.com/jsdelivr/npm/three@0.128.0/build/three.min.js"></script>
   ```

### UI/UX Design Patterns

#### Common UI Components
- **Rules Modal**: Initial popup showing game instructions with "Start Game" button
  - Typically hidden after first interaction, with floating help button (❓) to reopen
- **Success Effects**: Centered overlay messages using `#successEffect` pattern with fade animations

#### Mobile Responsiveness
- Use `@media (max-width: 768px)` breakpoints
- Switch from fixed positioning to flexbox layouts on small screens

### JavaScript Patterns

#### No DOMContentLoaded
- **Start game logic at the end of script tags** - do not wrap in `DOMContentLoaded`
- Initialize immediately after DOM is parsed

#### Event-Driven Architecture
All games implement a parent-child messaging system with `postMessage`:

```javascript
// Standard message types to handle:
window.addEventListener('message', function(e) {
  switch(e.data.type) {
    case 'setGameConfig':      // Receive markdown/JSON config from parent
  }
});

// Standard events to send to parent:
window.parent.postMessage({ type: 'gameLoaded' }, '*');
window.parent.postMessage({ type: 'gameStarted' }, '*');
window.parent.postMessage({ 
  type: 'gameFinished', 
  data: { earnedPoints, wpm, accuracy, difficulty } 
}, '*');
```

#### Game State Management
- Track `gameStarted` flag globally to send `gameLoaded` only once
- Store high scores in `localStorage` (e.g., `bestScore`, `highestScore`)

### Keepwork SDK Integration

When games need server-side features (data storage, TTS, LLM chat), include:

```html
<script src="https://cdn.keepwork.com/sdk/keepworkSDK.iife.js?v=20260515"></script>
```

Initialize the SDK:
```javascript
const sdk = new KeepworkSDK({
  timeout: 30000
});
console.log(`Keepwork SDK initialized token: ${sdk.token}`);
```

**SDK Features Used:**
- Text-to-speech services
- LLM chatbot integration (see `characterAI.html`)
- User data persistence
- Authentication via URL token parameter: `?token=eyJhbGci...`


## Development Workflow

### Creating New Games
1. Copy structure from similar game in root directory
2. Use Tailwind CDN - never create separate CSS files
3. Implement standard message handlers for parent integration
4. Add rules modal with floating help button
5. Test landscape layout without scrolling

### Editing Existing Games
- **Make small, incremental edits** - don't regenerate entire files
- Preserve existing game logic and state management
- Maintain backward compatibility with parent window messaging

## Common Pitfalls to Avoid

❌ Don't use external CSS/font files  
❌ Don't wrap initialization in DOMContentLoaded  
❌ Don't create multi-file projects  
❌ Don't ignore mobile responsiveness  
❌ Don't forget parent window messaging protocol  

✅ Do use Tailwind CDN for all styling  
✅ Do start game logic at end of script tag  
✅ Do keep everything in single HTML file  
✅ Do design for landscape-first  
✅ Do implement standard postMessage handlers
