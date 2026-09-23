/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The pipeline reads content/meera-voice/**/*.md and content/voice-corpus.json
  // from disk at runtime; Next's default file tracing can miss dynamic fs
  // reads, so we pin them explicitly for every serverless function.
  outputFileTracingIncludes: {
    "/api/**/*": ["./content/**/*"],
  },
};

export default nextConfig;
