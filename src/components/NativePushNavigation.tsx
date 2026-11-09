import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { consumeNativePushPath, subscribeNativePush } from "../services/nativePushService";

export default function NativePushNavigation() {
  const navigate = useNavigate();
  useEffect(() => {
    const route = () => { const path = consumeNativePushPath(); if (path) navigate(path); };
    const unsubscribe = subscribeNativePush(route);
    route();
    return unsubscribe;
  }, [navigate]);
  return null;
}
