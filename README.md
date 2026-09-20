# MineTock upload service

Cloudflare Worker for uploading MineTock videos to Cloudinary.

Cloudflare Builds settings:
- Root directory: backend
- Build command: npm ci
- Deploy command: npx wrangler deploy

Runtime secrets (Cloudflare Settings, not GitHub):
- CLOUDINARY_API_KEY
- CLOUDINARY_API_SECRET

The wrangler.toml file configures the Firebase project, Cloudinary cloud name,
allowed website origins and the UPLOAD_GATE Durable Object with its migration.
No manual Durable Object binding is required when deploying with Wrangler.

This repository package contains the upload service only, not the website or Android app.
