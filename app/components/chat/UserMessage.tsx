/*
 * @ts-nocheck
 * Preventing TS checks with files presented in the video for a better presentation.
 */
import { MODEL_REGEX, PROVIDER_REGEX } from '~/utils/constants';
import { Markdown } from './Markdown';
import type {
  TextUIPart,
  ReasoningUIPart,
  ToolInvocationUIPart,
  SourceUIPart,
  FileUIPart,
  StepStartUIPart,
} from '@ai-sdk/ui-utils';

interface UserMessageProps {
  content: string | Array<{ type: string; text?: string; image?: string }>;
  parts:
    | (TextUIPart | ReasoningUIPart | ToolInvocationUIPart | SourceUIPart | FileUIPart | StepStartUIPart)[]
    | undefined;
}

export function UserMessage({ content, parts }: UserMessageProps) {
  // Extract images from parts - look for file parts with image mime types
  const images =
    parts?.filter(
      (part): part is FileUIPart => part.type === 'file' && 'mimeType' in part && part.mimeType.startsWith('image/'),
    ) || [];

  if (Array.isArray(content)) {
    const textItem = content.find((item) => item.type === 'text');
    const textContent = stripMetadata(textItem?.text || '');

    return (
      <div className="flex flex-col bg-[var(--theme-accent-500-10,#9C7DFF1A)] backdrop-blur-sm px-5 p-3.5 w-auto rounded-lg ml-auto">
        {textContent && <Markdown html>{textContent}</Markdown>}
        {images.map((item, index) => (
          <img
            key={index}
            src={`data:${item.mimeType};base64,${item.data}`}
            alt={`Image ${index + 1}`}
            className="max-w-full h-auto rounded-lg"
            style={{ maxHeight: '512px', objectFit: 'contain' }}
          />
        ))}
      </div>
    );
  }

  const textContent = stripMetadata(content);

  return (
    <div className="flex flex-col bg-[var(--theme-accent-500-10,#9C7DFF1A)] backdrop-blur-sm px-5 p-3.5 w-auto rounded-lg ml-auto">
      {images.length > 0 && (
        <div className="flex gap-3.5 mb-4">
          {images.map((item, index) => (
            <div className="relative flex rounded-lg border border-bolt-elements-borderColor overflow-hidden">
              <div className="h-16 w-16 bg-transparent outline-none">
                <img
                  key={index}
                  src={`data:${item.mimeType};base64,${item.data}`}
                  alt={`Image ${index + 1}`}
                  className="h-full w-full rounded-lg"
                  style={{ objectFit: 'fill' }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
      <Markdown html>{textContent}</Markdown>
    </div>
  );
}

function stripMetadata(content: string) {
  const artifactRegex = /<boltArtifact\s+[^>]*>[\s\S]*?<\/boltArtifact>/gm;
  return content.replace(MODEL_REGEX, '').replace(PROVIDER_REGEX, '').replace(artifactRegex, '');
}
