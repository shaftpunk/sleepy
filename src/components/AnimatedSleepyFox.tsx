import { memo, useEffect, useRef } from "react";
import awakeFox from "../assets/awake-fox-home.png";
import sleepingFox from "../assets/sleeping-fox-home.png";
import awakeFallback from "../assets/awake-fox.png";
import sleepingFallback from "../assets/sleeping-fox.png";

export const AnimatedSleepyFox = memo(function AnimatedSleepyFox({ sleeping }: { sleeping: boolean }) {
  const slot = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = slot.current;
    if (!element || !("IntersectionObserver" in window)) return;

    let visible = false;
    const update = () => {
      element.dataset.playing = String(visible && !document.hidden);
    };
    const observer = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      update();
    });
    observer.observe(element);
    document.addEventListener("visibilitychange", update);
    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", update);
    };
  }, []);

  return (
    <div ref={slot} className="home-orb-fox-slot" data-playing="false">
      <div className="home-orb-fox-motion">
        <img className="home-current-animal" src={sleeping ? sleepingFox : awakeFox}
          alt="" draggable={false} onError={event => {
            const image = event.currentTarget;
            const fallback = sleeping ? sleepingFallback : awakeFallback;
            if (image.getAttribute("src") !== fallback) image.src = fallback;
          }} />
      </div>
    </div>
  );
});
