const uploadForm = document.getElementById("uploadForm");
const resultTable = document.getElementById("resultTable");

uploadForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const file = document.getElementById("imageInput").files[0];
  if (!file) return alert("Please select an image first!");

  const formData = new FormData();
  formData.append("image", file);

  const res = await fetch("/upload", { method: "POST", body: formData });
  const data = await res.json();
  addRow(data);
});

async function loadData() {
  const res = await fetch("/data");
  const data = await res.json();
  resultTable.innerHTML = "";
  data.forEach(addRow);
}

function addRow(item) {
  const row = document.createElement("tr");
  row.innerHTML = `
    <td class="border p-2"><img src="/uploads/${item.file}" class="w-40 rounded shadow" /></td>
    <td class="border p-2 text-center">${item.equipped}</td>
    <td class="border p-2 text-center">${item.inventory}</td>
    <td class="border p-2 text-green-600 font-bold text-center">${item.combatPower}</td>
  `;
  resultTable.appendChild(row);
}

loadData();
