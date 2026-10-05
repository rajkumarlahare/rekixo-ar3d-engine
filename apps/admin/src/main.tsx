import React, { Suspense, lazy } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

const EngineDashboard = lazy(() => import("./dashboard/EngineDashboard"));
const SourcePackReview = lazy(() => import("./source-pack/SourcePackReview"));
const Studio = lazy(() => import("./studio/Studio"));
const GeoMapper3D = lazy(() => import("./geo/GeoMapper3D"));
const PublishedViewer = lazy(() => import("./studio/PublishedViewer"));
const CloudLogin = lazy(() => import("./CloudLogin"));

function RouteLoading({ label }: { label: string }) {
  return (
    <main className="route-loading">
      <p className="eyebrow">REKIXO AR3D ENGINE</p>
      <h1>{label}</h1>
    </main>
  );
}

function AdminRouter() {
  const path = window.location.pathname.replace(/\/$/, "");

  if (path.startsWith("/3Dprojects/showcase/")) {
    return (
      <Suspense fallback={<RouteLoading label="Loading published design…" />}>
        <PublishedViewer />
      </Suspense>
    );
  }

  if (path === "/3Dprojects/source-pack") {
    return (
      <Suspense fallback={<RouteLoading label="Opening Source Pack Review…" />}>
        <SourcePackReview />
      </Suspense>
    );
  }

  if (path === "/3Dprojects/geo-mapper") {
    return (
      <Suspense fallback={<RouteLoading label="Opening 3D Jio Mapper…" />}>
        <GeoMapper3D />
      </Suspense>
    );
  }

  if (path === "/3Dprojects/studio") {
    return (
      <Suspense fallback={<RouteLoading label="Opening Design Studio…" />}>
        <Studio />
      </Suspense>
    );
  }

  if (path === "/3Dprojects/login") {
    return (
      <Suspense fallback={<RouteLoading label="Opening Engine Admin sign-in…" />}>
        <CloudLogin />
      </Suspense>
    );
  }

  return (
    <Suspense fallback={<RouteLoading label="Opening Engine projects…" />}>
      <EngineDashboard />
    </Suspense>
  );
}

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root mount node");
createRoot(root).render(
  <React.StrictMode>
    <AdminRouter />
  </React.StrictMode>,
);
