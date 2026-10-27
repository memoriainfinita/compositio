import { startServiceWorker } from './sw/register';

// Placeholder shell until step 5 of the plan builds the interface.
const update = document.getElementById('update') as HTMLDivElement;
const apply = document.getElementById('update-apply') as HTMLButtonElement;

void startServiceWorker((applyUpdate) => {
  apply.onclick = applyUpdate;
  update.hidden = false;
});
