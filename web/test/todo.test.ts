import { expect, test } from "bun:test";

// Bun's module mocks survive between files. Run the fake-service suite in its own
// process so real transport tests never import its mocks, regardless of file order.
if (process.env.TEF_TEST_TODO_ISOLATED === "1") {
  await import("./todo.cases");
} else {
  test("record hooks against fake services (isolated module mocks)", async () => {
    const child = Bun.spawn([process.execPath, "test", import.meta.path], {
      cwd: import.meta.dir,
      env: { ...process.env, TEF_TEST_TODO_ISOLATED: "1" },
      stdout: "pipe", stderr: "pipe",
    });
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
    ]);
    expect({ code, errors: code ? stdout + stderr : "" }).toEqual({ code: 0, errors: "" });
  }, 15_000);
}
