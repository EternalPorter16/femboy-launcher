// Closing a window must not abandon live games or their pending save jobs.
function create({ isBusy, hide, quit }) {
  let pending = false;
  return {
    get quitPending() { return pending; },
    close(event) {
      if (!isBusy()) return;
      event.preventDefault();
      hide();
    },
    beforeQuit(event) {
      if (!isBusy()) return;
      event.preventDefault();
      pending = true;
      hide();
    },
    idle() {
      if (pending && !isBusy()) {
        pending = false;
        quit();
      }
    },
  };
}

module.exports = { create };
