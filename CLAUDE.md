# Tamas Mihaly AI — Project Context

## What this project is
The Tamas Mihaly AI personal brand site. A dark-themed, single-column HTML/CSS site deployed on Vercel. No frameworks — plain HTML files.

## Deployment
- **Live URL:** https://tamasmihalyai.vercel.app
- **GitHub:** https://github.com/tamasmihalyai/tamasmihalyai-site
- **Auto-deploy:** push to `main` → Vercel deploys automatically
- **Vercel project:** `tamasmihalyai` under team `hello-4259s-projects`
- **Deployment Protection:** needs to be disabled in Vercel dashboard (Settings → Deployment Protection) so the site is publicly accessible without login

## Local project folder
`/Users/tamasmihaly/Claude Code/tamasmihalyai-linkinbio`
(Note: the user wants to rename this folder to `tamasmihalyai` — do this after closing the current Claude Code session)

## Files
- `tamasmihalyai-landing-v5.html` — original source file
- `index.html` — the live version (copy of v5, served by Vercel)

## Pages planned / in progress
- `index.html` — main link-in-bio landing page ✅ live
- `resources.html` — Free AI Resource Library page (to be built). Linked from the "Get Free Access →" button on the main page. Should show the 40+ resources with an email opt-in.

## Brand & design
A Claude Code skill exists for this brand: `tamasmihalyai-brand`
- Installed locally in the skills plugin
- `.skill` file saved to Desktop for installing in Claude.ai chat

**Always use the `tamasmihalyai-brand` skill when building any page for this site.**

Key design tokens:
- Background: `#1a202c`, Cards: `#232b3a`
- Accent: `#00bcd4` (cyan), Secondary: `#a6b6f8` (lavender)
- Fonts: Inter + Fraunces (Google Fonts)
- Max-width: 560px, single column

## Contact / identity
- Email: hello@thrivingcolibri.ai
- Handle: @tamasmihalyai
- ConvertKit newsletter: https://tamas-mihaly-ai.kit.com (uid: 71994beb42)

## Git setup
- GitHub CLI (`gh`) is installed and authenticated as `tamasmihalyai`
- To deploy: just `git add`, `git commit`, `git push` — Vercel handles the rest
