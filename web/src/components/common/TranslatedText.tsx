import { useTranslatedText } from '@/lib/translate';

/** A short label (a tag) in the UI language when translation is on, the original on hover. The
    caller keeps using the original as the value, so filtering never depends on the translation. */
export function TranslatedText({ text }: { text: string }) {
  const translated = useTranslatedText(text, 'sentence');
  return translated ? <span title={text}>{translated}</span> : <>{text}</>;
}
