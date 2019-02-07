"use strict";

const $ = document.querySelector.bind(document);
const NO_VIDEO = { NO_VIDEO: true, };

function onCSVParsed(results, file) {
	// results.data
	
	$("#parse_mode").style.display = "";
	
	var d = new Date(file.lastModified);
	if(d.getMonth() == 0) {
		$("#year").value = d.getFullYear() - 1;
		$("#month").value = d.getMonth() + 12;
	} else {
		$("#year").value = d.getFullYear();
		$("#month").value = d.getMonth();
	}
	
	$("#upload").style.display = "none";
	
	$("#monthly").addEventListener("click", e => {
		$("#parse_mode").style.display = "none";
		showTable(results.data, {
			type: "monthly",
			month: parseInt($("#month").value),
			year: parseInt($("#year").value),
		}).catch(console.error);
	});
	
	$("#yearly").addEventListener("click", e => {
		$("#parse_mode").style.display = "none";
		YouTube.getPlaylist($("#playlist").value)
		.then(playlist => ({type: "yearly", playlist: playlist}))
		.then(data => showTable(results.data, data))
		.catch(error => {
			console.error(error);
			$("#parse_mode").style.display = "";
			$("#table").style.display = "";
		});
	});
}

function exportCSV(data, filename, options) {
	let csv = Papa.unparse(data, options);
	
	var blob = new Blob([csv], {
		type: "text/csv",
	});
	saveAs(blob, filename);
}

async function showTable(csvData, params) {
	if(params.type == "yearly") {
		var datalist = $("#datalist");
		if(datalist)
			datalist.innerHTML = "";
		else
			datalist = document.body.appendChild(document.createElement("datalist"));
		datalist.id = "datalist"
		
		for(let video of params.playlist.items) {
			let option = datalist.appendChild(document.createElement("option"))
			option.value = video.snippet.title;
		}
	} else if(params.type == "monthly") {
		// YouTube's upload date is based on Californian timezone, which is either -08:00 (PDT) or -07:00 (PST)
		// we give an extra hour to compensate for the DST change
		let year = params.year, month = params.month;
		params.start = new Date(`${year}-${month.toString().padStart(2,"0")}-01T00:00:00.000-07:00`);
		month++;if(month>12){month-=12;year++};
		params.end   = new Date(`${year}-${month.toString().padStart(2,"0")}-01T00:00:00.000-08:00`);
	}
	
	var table = $("#table");
	
	var row = table.insertRow(-1);
	for(let cell of csvData.shift()) {
		let th = row.appendChild(document.createElement("th"));
		let pre = th.appendChild(document.createElement("pre"));
		pre.textContent = cell;
	}
	
	let resolvers = [];
	let submissions = [];
	
	for(let row of csvData) {
		if(row.length<=1) continue;
		
		let tr = table.insertRow(-1);
		
		let submission = new Submission(tr, row.shift());
		submissions.push(submission);
		submission.onDelete = () => {
			let index = submissions.indexOf(submission);
			if(index > -1)
				submissions.splice(index, 1);
		};
		
		for(let cell of row) {
			let td = tr.insertCell(-1);
			let resolver = new Resolver(td, cell, params);
			submission.addResolver(resolver);
			resolvers.push(resolver);
		}
	}
	
	async function resolve() {
		while(resolvers.length) {
			let resolver = resolvers.shift();
			try {
				await resolver.resolve();
			} catch(e) {
				console.error(e);
			}
		}
	}
	let tasks = [];
	for(let i=0;i<10;i++)
		tasks.push(resolve());
	
	await Promise.all(tasks);
	
	$("#toolbar").style.display = "";
	$("#exportvotes").onclick = async () => {
		let rows = [];
		for(let submission of submissions) {
			let row1 = [submission.label];
			let row2 = [""];
			rows.push(row1, row2);
			
			for(let cell of submission.cells) {
				if(cell.video && cell.video != NO_VIDEO) {
					row1.push(cell.video.snippet.title);
					row2.push("https://www.youtube.com/watch?v=" + cell.video.id);
				} else {
					row1.push("");
					row2.push("");
				}
			}
		}
		
		exportCSV(rows, "votes.csv");
	};
	
	$("#exportstats").onclick = async () => {
		let videos = new Map();
		
		for(let submission of submissions) {
			submission.update();
			
			for(let id of submission.uniques) {
				let count = videos.get(id);
				if(!count)
					count = 1
				else
					count++;
				videos.set(id, count);
			}
		}
		
		let rows = await Promise.all(Array.from(videos.entries()).map(async ([id, votes]) => {
			let item = YouTube.getVideo(id);
			let query = new URLSearchParams();
			query.set("id", id);
			query.set("part", "statistics");
			let stats = YouTube.get("videos", query);
			item = await item;
			stats = await stats;
			
			return {
				title: item.snippet.title,
				link: "https://www.youtube.com/watch?v=" + item.id,
				channel: item.snippet.channelTitle,
				views: parseInt(stats.items[0].statistics.viewCount),
				votes,
			};
		}));
		
		rows.sort((a,b) => {
			if(a.votes != b.votes) {
				return b.votes - a.votes;
			} else if(a.views != b.views) {
				return b.views - a.views;
			}
			return a.title.localeCompare(b.title);
		});
		
		exportCSV(rows, "stats.csv", {header:true});
	};
}

class Submission {
	constructor(tr, label) {
		this.tr = tr;
		this.cells = [];
		this.label = label;
		
		// Timestamp
		this.td = tr.insertCell(-1);
		let div = this.td.appendChild(document.createElement("div"));
		div.className = "timestamp";
		div.textContent = label;
		
		let button = this.td.appendChild(document.createElement("button"));
		button.textContent = "delete";
		button.addEventListener("click", () => {
			if(!confirm("Are you sure you want to delete this submission?"))
				return;
			
			this.onDelete();
			this.tr.parentNode.removeChild(tr);
		});
		
		this.state = this.td.appendChild(document.createElement("div"));
	}
	
	addResolver(resolver) {
		this.cells.push(resolver);
		resolver.onChange = () => this.update();
	}
	
	update() {
		this.videos = this.cells.filter(cell => cell.video && cell.video != NO_VIDEO).map(cell => cell.video.id);
		this.uniques = new Set(this.videos);
		
		this.state.innerHTML = `${this.videos.length} video(s)<br>${this.uniques.size} unique video(s)`;
	}
}

class Resolver {
	constructor(td, text, params) {
		this.td = td;
		this.params = params;
		
		this.onChange = () => null;
		
		this.td.className = "init";
		this.input = this.td.appendChild(document.createElement("input"));
		this.input.value = text;
		this.input.addEventListener("change", e => {
			this.resolve().catch(console.error);
		});
		this.input.addEventListener("keyup", e => {
			if(e.key == "Enter")
				this.resolve().catch(console.error);
		});
		
		if(params.type == "yearly")
			this.input.setAttribute("list", "datalist");
		
		this.preview = this.td.appendChild(document.createElement("div"));
		this.preview.className = "preview";
	}
	
	async resolve() {
		if(this.input.value.trim() == "") {
			this.td.className = "";
			this.video = NO_VIDEO;
			this.preview.innerHTML = "";
			this.onChange();
			return;
		}
		
		this.td.className = "resolving";
		
		try {
			if(this.params.type == "yearly")
				await this.resolveYearly();
			else
				await this.resolveMonthly();
		} catch(e) {
			this.td.className = "error";
			throw e;
		}
	}
	
	async resolveMonthly() {
		let groups = this.input.value.trim().match(/(?:https?:\/\/)?(?:youtu\.be\/|(?:www\.|m\.)?youtube\.com\/(?:watch|v|embed)(?:\.php)?(?:\?.*v=|\/))([a-zA-Z0-9\-_]+)/i);
		if(groups) {
			let video = await YouTube.getVideo(groups[1]);
			let publishedAt = new Date(video.snippet.publishedAt);
			if(publishedAt > this.params.end || publishedAt < this.params.start) {
				let local = new Date(publishedAt.getTime() - (8 * 60 - publishedAt.getTimezoneOffset()) * 60 * 1000); // convert from local to Pacific
				this.preview.innerHTML = "Video was published on " + local.toLocaleDateString();
				throw Error("Video was published on " + local.toLocaleDateString());
			}
			
			return await this.setVideo(video);
		}
		
		let query = new URLSearchParams();
		query.set("q", this.input.value);
		query.set("publishedAfter", this.params.start.toISOString());
		query.set("publishedBefore", this.params.end.toISOString());
		query.set("part", "snippet");
		query.set("type", "video");
		let results = await YouTube.search(query);
		if(!results.items.length) {
			this.preview.innerHTML = "No matching videos found";
			throw Error("YouTube API found no matches");
		}
		
		if(!results.fuse) {
			const options = {
				shouldSort: true,
				includeScore: false,
				threshold: 0.333,
				location: 0,
				distance: 100,
				maxPatternLength: 32,
				minMatchCharLength: 1,
				keys: [
					"snippet.title"
				],
			};
			// assign to save it into search cache
			results.fuse = new Fuse(results.items, options); // "list" is the item array
		}
		let matches = results.fuse.search(this.input.value);
		if(!matches.length) {
			this.preview.innerHTML = "No matching videos found";
			throw Error("Fuzzy search found no match among results");
		}
		
		return await this.setVideo(matches[0])
	}
	
	async resolveYearly() {
		for(let video of this.params.playlist.items) {
			if(video.snippet.title.toLowerCase() == this.input.value.toLowerCase())
				return await this.setVideo(video);
		}
		throw Error("No video found");
	}
	
	async setVideo(video) {
		this.video = await YouTube.getVideo(video);
		
		this.preview.innerHTML = "";
		var img = this.preview.appendChild(document.createElement("img"));
		img.src = this.video.snippet.thumbnails.default.url;
		var title = this.preview.appendChild(document.createElement("h5"));
		var link = title.appendChild(document.createElement("a"));
		link.textContent = this.video.snippet.title;
		link.title = this.video.snippet.title;
		link.href = "https://www.youtube.com/watch?v=" + this.video.id;
		
		this.td.className = "resolved";
		this.onChange();
	}
}

function handleFile(files) {
	if(!files.length)
		return;
	
	Papa.parse(files[0], {
		complete: e=>onCSVParsed(e, files[0]),
	});
}

function onFileChanged(ev) {
	handleFile(ev.target.files);
}

function onFileDropped(ev) {
	ev.preventDefault();
	handleFile(ev.dataTransfer.files);
}

addEventListener("load", ev => {
	$("#file").addEventListener("change", onFileChanged);
	$("#upload").addEventListener("drop", onFileDropped);
	$("#upload").addEventListener("dragover", ev => ev.preventDefault());
});
