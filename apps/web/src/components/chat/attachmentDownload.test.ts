import { EnvironmentId } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vitest";

import { AttachmentDownloadError, fetchAttachmentBlob, saveBlobAsFile } from "./attachmentDownload";

const ENVIRONMENT_ID = EnvironmentId.make("environment-local");

describe("attachmentDownload", () => {
  it("fetches downloads with saved bearer auth and same-origin credentials", async () => {
    const fetchImpl = vi.fn(async () => new Response("attachment-body", { status: 200 }));
    const readBearerToken = vi.fn(async () => "saved-bearer-token");

    const blob = await fetchAttachmentBlob({
      environmentId: ENVIRONMENT_ID,
      url: "https://workstation.example.test/attachments/file-1/download",
      fetchImpl,
      readBearerToken,
    });

    expect(await blob.text()).toBe("attachment-body");
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://workstation.example.test/attachments/file-1/download",
      {
        credentials: "same-origin",
        headers: { authorization: "Bearer saved-bearer-token" },
      },
    );
  });

  it("still includes same-origin cookie credentials when no saved bearer token exists", async () => {
    const fetchImpl = vi.fn(async () => new Response("attachment-body", { status: 200 }));

    await fetchAttachmentBlob({
      environmentId: ENVIRONMENT_ID,
      url: "/attachments/file-1/download",
      fetchImpl,
      readBearerToken: async () => null,
    });

    expect(fetchImpl).toHaveBeenCalledWith("/attachments/file-1/download", {
      credentials: "same-origin",
    });
  });

  it("surfaces authenticated route failures without navigating away", async () => {
    await expect(
      fetchAttachmentBlob({
        environmentId: ENVIRONMENT_ID,
        url: "/attachments/file-1/download",
        fetchImpl: async () => new Response("Authentication required.", { status: 401 }),
        readBearerToken: async () => null,
      }),
    ).rejects.toMatchObject(new AttachmentDownloadError("Authentication required.", 401));
  });

  it("triggers a browser blob download", () => {
    const appendChild = vi.fn();
    const click = vi.fn();
    const remove = vi.fn();
    const revokeObjectUrl = vi.fn();
    const anchor = {
      download: "",
      href: "",
      rel: "",
      style: { display: "" },
      click,
      remove,
    } as unknown as HTMLAnchorElement;
    const documentRef = {
      body: { appendChild },
      documentElement: null,
      createElement: vi.fn(() => anchor),
    } as unknown as Document;

    saveBlobAsFile({
      blob: new Blob(["attachment-body"]),
      fileName: "notes.txt",
      documentRef,
      createObjectUrl: () => "blob:attachment-url",
      revokeObjectUrl,
      scheduleRevoke: (callback) => callback(),
    });

    expect(anchor.href).toBe("blob:attachment-url");
    expect(anchor.download).toBe("notes.txt");
    expect(anchor.rel).toBe("noopener");
    expect(anchor.style.display).toBe("none");
    expect(appendChild).toHaveBeenCalledWith(anchor);
    expect(click).toHaveBeenCalledOnce();
    expect(remove).toHaveBeenCalledOnce();
    expect(revokeObjectUrl).toHaveBeenCalledWith("blob:attachment-url");
  });
});
