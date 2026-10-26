import { useRef, useState } from "react";

import { useTranslation } from "../i18n";
import { sendFamilyMessage } from "../services/familyMessageService";

const MAX_MESSAGE_LENGTH = 200;

type Props = {
  babyId: string;
  babyName: string;
  onClose: () => void;
};

export default function FamilyMessageModal({
  babyId,
  babyName,
  onClose,
}: Props) {
  const { t } = useTranslation();
  const [customMessage, setCustomMessage] = useState("");
  const [sending, setSending] = useState(false);
  const sendingRef = useRef(false);
  const [result, setResult] = useState<
    "sent" | "noRecipients" | "error" | null
  >(null);

  async function send(message: string) {
    const trimmed = message.trim();

    if (!trimmed || sendingRef.current) return;

    try {
      sendingRef.current = true;
      setSending(true);
      setResult(null);

      const delivery = await sendFamilyMessage(babyId, trimmed);
      setResult(delivery.sent > 0 ? "sent" : "noRecipients");
    } catch (error) {
      console.error("Could not send family message:", error);
      setResult("error");
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={sending ? undefined : onClose}>
      <section
        className="feed-modal family-message-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="family-message-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="modal-header">
          <div>
            <p className="eyebrow">{babyName}</p>
            <h2 id="family-message-title">{t("familyMessage.title")}</h2>
          </div>

          <button
            type="button"
            className="modal-close"
            disabled={sending}
            aria-label={t("familyMessage.close")}
            onClick={onClose}
          >
            ×
          </button>
        </div>

        <div className="family-message-quick-actions">
          <button
            type="button"
            className="secondary-button"
            disabled={sending}
            onClick={() => void send(t("familyMessage.comeHome"))}
          >
            {t("familyMessage.comeHome")}
          </button>

          <button
            type="button"
            className="secondary-button"
            disabled={sending}
            onClick={() => void send(t("familyMessage.onMyWay"))}
          >
            {t("familyMessage.onMyWay")}
          </button>
        </div>

        <form
          className="family-message-form"
          onSubmit={(event) => {
            event.preventDefault();
            void send(customMessage);
          }}
        >
          <label className="form-field">
            <span>{t("familyMessage.writeMessage")}</span>
            <textarea
              value={customMessage}
              maxLength={MAX_MESSAGE_LENGTH}
              disabled={sending}
              placeholder={t("familyMessage.writeMessage")}
              onChange={(event) => setCustomMessage(event.target.value)}
            />
          </label>

          <div className="family-message-form-footer">
            <span>{customMessage.length}/{MAX_MESSAGE_LENGTH}</span>
            <button
              type="submit"
              className="primary-button"
              disabled={sending || !customMessage.trim()}
            >
              {sending ? t("familyMessage.sending") : t("familyMessage.send")}
            </button>
          </div>
        </form>

        {result === "sent" && (
          <p className="settings-success" role="status">
            {t("familyMessage.sent")}
          </p>
        )}

        {result === "noRecipients" && (
          <p className="muted" role="status">
            {t("familyMessage.noRecipients")}
          </p>
        )}

        {result === "error" && (
          <p className="settings-error" role="alert">
            {t("familyMessage.error")}
          </p>
        )}
      </section>
    </div>
  );
}
