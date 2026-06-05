module.exports = {
  apps: [
    {
      name: process.env.APP_NAME || "brainsync",
      script: "dist-server/index.js",
      exec_mode: "fork",
      instances: 1,
      time: true,
      env: {
        NODE_ENV: "production",
        PORT: process.env.PORT || "3000"
      }
    }
  ]
};
