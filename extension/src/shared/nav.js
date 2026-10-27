// Opens the settings/records page, reusing an already-open tab instead of piling up new ones.
// hash: "#records" or "#class"
export async function openPage(hash = "") {
  const url = chrome.runtime.getURL("options.html");
  const open = await chrome.tabs.query({ url: `${url}*` });
  if (open.length) {
    await chrome.tabs.update(open[0].id, { active: true, url: url + hash });
    await chrome.windows.update(open[0].windowId, { focused: true });
  } else {
    await chrome.tabs.create({ url: url + hash });
  }
  window.close(); // closes the popup
}

// This file is part of MeetSentinel.

// MeetSentinel is free software: you can redistribute it and/or modify it under the terms of the GNU General Public License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version.

// MeetSentinel is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU General Public License for more details.

// You should have received a copy of the GNU General Public License along with Foobar. If not, see <https://www.gnu.org/licenses/>.
