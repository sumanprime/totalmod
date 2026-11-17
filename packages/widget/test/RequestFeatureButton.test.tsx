import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RequestFeatureButton } from "../src/index.ts";

const spec = {
  title: "Word count under each note",
  userStory: "As a writer I want to see word counts so I can keep posts short.",
  acceptanceCriteria: ["Each note shows its word count", "Empty notes show 0 words"],
  uiLocation: "Notes list",
  outOfScope: ["Character counts"],
};

const questions = {
  id: "req1234567",
  status: "interviewing",
  draft: {
    kind: "questions",
    questions: [
      {
        id: "where",
        text: "Where should it appear?",
        options: ["Notes list", "Editor"],
        allowFreeText: true,
      },
      {
        id: "what",
        text: "What should it count?",
        options: ["Words", "Characters"],
        allowFreeText: true,
      },
    ],
  },
};

type Route = (body: unknown) => { status?: number; json: unknown };

/** Fake server: routes by "METHOD path", records request bodies. */
function serve(routes: Record<string, Route>) {
  const calls: { key: string; body: unknown }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const key = `${init?.method ?? "GET"} ${new URL(url, "http://app.test").pathname}`;
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ key, body });
      const route = routes[key];
      if (!route) return Response.json({ error: `No route ${key}` }, { status: 404 });
      const { status = 200, json } = route(body);
      return Response.json(json, { status });
    }),
  );
  return calls;
}

const bodyOf = (calls: { key: string; body: unknown }[], key: string) =>
  calls.find((c) => c.key === key)?.body;

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function openAndAsk(user: ReturnType<typeof userEvent.setup>, text: string) {
  await user.click(await screen.findByRole("button", { name: "Request a feature" }));
  await user.type(screen.getByLabelText("What would make this app better for you?"), text);
  await user.click(screen.getByRole("button", { name: "Continue" }));
}

describe("RequestFeatureButton", () => {
  it("renders nothing when requests are not enabled for this user", async () => {
    const calls = serve({ "GET /api/totalmod/me": () => ({ json: { enabled: false } }) });
    const { container } = render(<RequestFeatureButton />);
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(container).toBeEmptyDOMElement();
  });

  it("walks request -> questions -> edit once -> confirm", async () => {
    const user = userEvent.setup();
    const calls = serve({
      "GET /api/totalmod/me": () => ({ json: { enabled: true } }),
      "GET /api/totalmod/requests": () => ({ json: { requests: [] } }),
      "POST /api/totalmod/requests": () => ({ json: questions }),
      "POST /api/totalmod/requests/req1234567/answers": () => ({
        json: { id: "req1234567", status: "interviewing", draft: { kind: "spec", spec } },
      }),
      "POST /api/totalmod/requests/req1234567/confirm": (body) => ({
        json: {
          id: "req1234567",
          status: "confirmed",
          spec: (body as { spec: unknown }).spec,
          issueNumber: 7,
        },
      }),
    });
    render(<RequestFeatureButton appVersion="1.4.0" />);

    await openAndAsk(user, "word counts please");
    expect(bodyOf(calls, "POST /api/totalmod/requests")).toEqual({
      text: "word counts please",
      route: "/",
      appVersion: "1.4.0",
    });

    const continueButton = await screen.findByRole("button", { name: "Continue" });
    expect(continueButton).toBeDisabled();
    await user.click(screen.getByRole("radio", { name: "Notes list" }));
    await user.click(screen.getAllByRole("radio", { name: "Something else" })[1] as HTMLElement);
    await user.type(
      screen.getByLabelText("Your answer: What should it count?"),
      "Words and minutes to read",
    );
    await user.click(continueButton);
    expect(bodyOf(calls, "POST /api/totalmod/requests/req1234567/answers")).toEqual({
      answers: { where: "Notes list", what: "Words and minutes to read" },
    });

    expect(await screen.findByText("Word count under each note")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Edit" }));
    const title = screen.getByLabelText("Feature");
    await user.clear(title);
    await user.type(title, "Word count on each note");
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    expect(screen.getByText("Word count on each note")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull(); // only one edit
    await user.click(screen.getByRole("button", { name: "Looks right, build it" }));

    expect(await screen.findByRole("status")).toHaveTextContent(
      "We're building Word count on each note",
    );
    const confirmed = bodyOf(calls, "POST /api/totalmod/requests/req1234567/confirm") as
      | { spec: { title: string } }
      | undefined;
    expect(confirmed?.spec.title).toBe("Word count on each note");
  });

  it("shows a decline kindly and lets the user start over", async () => {
    const user = userEvent.setup();
    serve({
      "GET /api/totalmod/me": () => ({ json: { enabled: true } }),
      "POST /api/totalmod/requests": () => ({
        json: {
          id: "req1",
          status: "declined",
          draft: { kind: "declined", reason: "Billing changes go to the team." },
        },
      }),
    });
    render(<RequestFeatureButton />);
    await openAndAsk(user, "coupon codes at checkout");
    expect(await screen.findByRole("status")).toHaveTextContent("Billing changes go to the team.");
    await user.click(screen.getByRole("button", { name: "Request something else" }));
    expect(screen.getByLabelText("What would make this app better for you?")).toHaveValue("");
  });

  it("shows server errors and keeps the text", async () => {
    const user = userEvent.setup();
    serve({
      "GET /api/totalmod/me": () => ({ json: { enabled: true } }),
      "POST /api/totalmod/requests": () => ({
        status: 429,
        json: { error: "You've sent a lot of requests today. Try again tomorrow." },
      }),
    });
    render(<RequestFeatureButton />);
    await openAndAsk(user, "more themes");
    expect(await screen.findByRole("alert")).toHaveTextContent("Try again tomorrow");
    expect(screen.getByLabelText("What would make this app better for you?")).toHaveValue(
      "more themes",
    );
  });

  describe("after confirming", () => {
    const base = { id: "req1234567", spec, iteration: 0, maxIterations: 3 };
    const ready = {
      ...base,
      status: "preview_ready",
      previewLink: "https://notes-git-req.vercel.app/totalmod/preview?token=signed",
    };

    it("offers the private preview link and sends fixes, then polls for the next preview", async () => {
      const user = userEvent.setup();
      let current: object = ready;
      const calls = serve({
        "GET /api/totalmod/me": () => ({ json: { enabled: true } }),
        "GET /api/totalmod/requests": () => ({ json: { requests: [current] } }),
        "POST /api/totalmod/requests/req1234567/feedback": () => {
          current = { ...base, status: "iterating", iteration: 1 };
          return { json: current };
        },
      });
      render(<RequestFeatureButton pollMs={30} />);

      await user.click(await screen.findByRole("button", { name: "Your feature is ready" }));
      expect(screen.getByRole("link", { name: "Try it" })).toHaveAttribute(
        "href",
        ready.previewLink,
      );
      expect(screen.getByRole("status")).toHaveTextContent("Only you can see it");

      await user.click(screen.getByRole("button", { name: "Fix this (3 rounds left)" }));
      await user.type(screen.getByLabelText("What should change?"), "make the number grey");
      await user.click(screen.getByRole("button", { name: "Send changes" }));
      expect(bodyOf(calls, "POST /api/totalmod/requests/req1234567/feedback")).toEqual({
        verdict: "fix",
        text: "make the number grey",
      });
      expect(await screen.findByRole("status")).toHaveTextContent("round 1 of 3");

      // The next deployment lands; polling picks it up.
      current = { ...ready, iteration: 1 };
      expect(await screen.findByRole("link", { name: "Try it" })).toBeVisible();
      expect(screen.getByRole("button", { name: "Fix this (2 rounds left)" })).toBeVisible();
    });

    it("sends a thumbs-up", async () => {
      const user = userEvent.setup();
      const calls = serve({
        "GET /api/totalmod/me": () => ({ json: { enabled: true } }),
        "GET /api/totalmod/requests": () => ({ json: { requests: [ready] } }),
        "POST /api/totalmod/requests/req1234567/feedback": () => ({
          json: { ...base, status: "ready" },
        }),
      });
      render(<RequestFeatureButton />);
      await user.click(await screen.findByRole("button", { name: "Your feature is ready" }));
      await user.click(screen.getByRole("button", { name: "Looks good" }));
      expect(await screen.findByRole("status")).toHaveTextContent("The team will review");
      expect(bodyOf(calls, "POST /api/totalmod/requests/req1234567/feedback")).toEqual({
        verdict: "up",
      });
    });

    it("hands over to the team when the fix rounds are used up", async () => {
      const user = userEvent.setup();
      serve({
        "GET /api/totalmod/me": () => ({ json: { enabled: true } }),
        "GET /api/totalmod/requests": () => ({
          json: { requests: [{ ...ready, iteration: 3 }] },
        }),
      });
      render(<RequestFeatureButton />);
      await user.click(await screen.findByRole("button", { name: "Your feature is ready" }));
      expect(screen.queryByRole("button", { name: /Fix this/ })).toBeNull();
      expect(screen.getByText(/The team will take it from here/)).toBeVisible();
    });
  });
});
