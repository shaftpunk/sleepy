import {
  useEffect,
  type ReactNode,
} from "react";

import { getMyBabies } from "../services/householdService";
import { useAppStore } from "../stores/appStore";

export default function BabyLoader({
  children,
}: {
  children: ReactNode;
}) {
  const setBabies =
    useAppStore((state) => state.setBabies);

  const currentBabyId =
    useAppStore((state) => state.currentBabyId);

  const setCurrentBabyId =
    useAppStore(
      (state) => state.setCurrentBabyId,
    );

  useEffect(() => {
    let cancelled = false;
    async function loadBabies() {
      try {
        const babies =
          await getMyBabies();

        if (cancelled) return;

        setBabies(babies);

        if (
          babies.length > 0 &&
          !babies.some(
            (baby) =>
              baby.id === currentBabyId,
          )
        ) {
          setCurrentBabyId(
            babies[0].id,
          );
        }
      } catch (error) {
        console.error(
          "Could not load babies:",
          error,
        );
      }
    }

    void loadBabies();
    return () => { cancelled = true; };
  }, [
    currentBabyId,
    setBabies,
    setCurrentBabyId,
  ]);

  return <>{children}</>;
}
