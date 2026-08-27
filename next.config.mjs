/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  /**
   * When Apache only forwards to Next (:3000), proxy Express API through Next
   * so https://social.avonixai.com/api/* reaches avonix-api on :4000.
   * Existing Next routes under src/app/api/* still take precedence (afterFiles).
   */
  async redirects() {
    return [
      { source: "/signin", destination: "/login", permanent: false },
      { source: "/sign-in", destination: "/login", permanent: false },
      { source: "/signup", destination: "/register", permanent: false },
      { source: "/sign-up", destination: "/register", permanent: false },
    ];
  },
  async rewrites() {
    const apiOrigin = (process.env.API_SERVER_URL || "http://127.0.0.1:4000").replace(
      /\/$/,
      ""
    );
    return {
      afterFiles: [
        {
          source: "/api/:path*",
          destination: `${apiOrigin}/api/:path*`,
        },
      ],
    };
  },
};

export default nextConfig;
