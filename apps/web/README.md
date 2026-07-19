# Queue Monitor web

React web application for authenticated, environment-scoped Queue Monitor telemetry.

```sh
npm run dev:web
```

Vite serves `http://localhost:5173` and proxies `/v1` plus `/socket.io` to the API at port 3000. The production Docker image serves the app on `http://localhost:4173` through Nginx with the same proxy paths.

The web application never receives or stores the JWT in JavaScript-accessible storage. Login sets an HttpOnly session cookie; only the non-secret selected environment ID is stored locally.
