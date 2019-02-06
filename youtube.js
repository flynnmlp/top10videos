var YouTube = {
	async get(method, params, options, json=true) {
		params.set("key", "AIzaSyDqfc_0tMsFe5XsQS4_nx3x8JZlfp56SLQ");
		var url = "https://content.googleapis.com/youtube/v3/" + method + "?" + params;
		var response = await fetch(url, options)
		if(!response.ok)
			throw response;
	
		if(json)
			return await response.json();
	
		return response;
	},
	
	async getList(method, params, options) {
		var items = [];
		while(true) {
			var result = await YouTube.get(method, params, options);
			items.push(...result.items)
			
			if(!result.nextPageToken)
				break;
			params.set("pageToken", result.nextPageToken);
		}
		
		result.items = items;
		return result;
	},
	
	async getPlaylist(id) {
		var groups = id.match(/^(?:https?:\/\/)?(?:www\.)?(?:youtube\.com|youtu\.be)\/.*[&?]list=([a-z0-9\-_]+)/i);
		if(groups)
			id = groups[1];
		
		var params = new URLSearchParams();
		params.set("part", "snippet");
		params.set("playlistId", id);
		params.set("maxResults", 50);
		var result = await YouTube.getList("playlistItems", params);
		return result;
	},
	
	videoCache: new Map,
	async getVideo(query) {
		var video, id = null;
		
		if(typeof query == "string") {
			id = query;
		} else {
			if(query.kind == "youtube#video") {
				video = query;
				id = query.id;
			} else if(query.kind == "youtube#playlistItem" && "snippet" in query && "resourceId" in query.snippet && "videoId" in query.snippet.resourceId) {
				id = query.snippet.resourceId.videoId;
			} else if(query.kind == "youtube#searchResult" && "id" in query && "videoId" in query.id && query.id.kind == "youtube#video") {
				id = query.id.videoId;
			} else {
				throw Error("Unknown snippet type");
			}
		}
		
		if(!video) {
			video = YouTube.videoCache.get(id);
		}
		if(!video) {
			let result = await YouTube.get("videos", new URLSearchParams({id:id,part:"snippet"}));
			video = result.items[0];
		}
		if(!video)
			throw Error("Invalid video");
		
		YouTube.videoCache.set(id, video);
		return video;
	},
	
	searchCache: new Map,
	async search(query) {
		query = new URLSearchParams(query);
		let key = query.toString();
		let result = YouTube.searchCache.get(key);
		if(result) return result;
		
		result = await YouTube.get("search", query);
		YouTube.searchCache.set(key, result);
		return result;
	}
}
