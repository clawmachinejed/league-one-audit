"use client";
import { useEffect } from "react";

export default function Admin() {
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.has("key")) {
      url.searchParams.delete("key");
      window.history.replaceState({}, "", url.toString());
    }
  }, []);
  return (
    <div>
      <h1 className="text-2xl font-bold">Admin</h1>
      <p className="text-sm text-gray-600">
        Use Admin API with the X-Admin-Key header for actions.
      </p>
    </div>
  );
}
