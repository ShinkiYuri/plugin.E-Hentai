class Semaphore {
  waitAsync () {
    return new Promise((resolve) => {
      if (this.availablePermits > 0) {
        this.availablePermits--
        resolve()
      } else {
        this.waiters.push(resolve)
      }
    })
  }

  release () {
    if (this.waiters.length > 0) {
      const resolve = this.waiters.shift()
      resolve()
    } else if (this.availablePermits < this.maxCount) {
      this.availablePermits++
    } else {
      throw new Error('Semaphore release error: max permit count exceeded.')
    }
  }

  constructor (initialCount, maxCount) {
    this.availablePermits = initialCount
    this.maxCount = maxCount
    this.waiters = []
  }
}


async function getMangaList (page, pageSize, keyword) {
  const url = 'https://hentag.com/public/api/vault-search'
  try {
    const payload = new URLSearchParams({});
    payload.append('p', page.toString());
    payload.append('s', pageSize.toString());
    if (keyword) {
      payload.append('t', keyword.toString());
    }

    const rawResponse = await window.Rulia.httpRequest({
      url: url,
      method: 'GET',
      payload: payload.toString()
    })

    const response = JSON.parse(rawResponse);
    var result = {
      list: []
    }

    for (var manga of response.works) {
      var comic = {
        title: manga.title,
        url: 'https://hentag.com/vault/' + manga.id,
        coverUrl: manga.coverImageUrl
      }
      result.list.push(comic);
    }
    window.Rulia.endWithResult(result);
  } catch (error) {
    window.Rulia.endWithException(error.message);
  }
}

async function getMangaData (dataPageUrl) {
  const seasonIdMatchExp = /vault\/([^?]+)/;
  const seasonIdMatch = dataPageUrl.match(seasonIdMatchExp);
  const url = 'https://hentag.com/public/api/vault/' + seasonIdMatch[1];
  try {
    const rawResponse = await window.Rulia.httpRequest({
      url: url,
      method: 'GET'
    });
    const response = JSON.parse(rawResponse);
    var description = new Date(response.lastModified).toLocaleDateString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).replace(/\//g, '-').replace(/-/g, '/');
    var result = {
      title: response.title,
      description: description,
      coverUrl: response.coverImageUrl,
      chapterList: [{
        title: '[e-hentai]' + response.title,
        url: response.locations[0]
      }]
    }
    window.Rulia.endWithResult(result);
  } catch (error) {
    window.Rulia.endWithException(error.message);
  }
}

async function getChapterImageList (chapterUrl) {
  try {
    let pageSize = 0;
    let urls = [chapterUrl]
    let chapterUrls = []
    const pageRawResponse = await window.Rulia.httpRequest({
      url: chapterUrl,
      method: 'GET'
    })
    const pageSizePattern = /<td class="gdt2">(\d+)\s*pages?<\/td>/;
    const pageSizeMatch = pageRawResponse.match(pageSizePattern)

    if (!pageSizeMatch) {
      return window.Rulia.endWithException(error.message)
    }

    pageSize = pageSizeMatch[1]

    // Get page urls.
    if (pageSize != 0) {
      for (i = 1; i <= parseInt(pageSize / 40); i++) {
        urls.push(chapterUrl + '?p=' + i);
      }

      const semaphore = new Semaphore(5, 5)
      const exec = async (cUrl) => {
        await semaphore.waitAsync()
        const chapterUrlsRawResponse = await window.Rulia.httpRequest({
          url: cUrl,
          method: 'GET'
        })
        const chapterUrlsPattern = /https:\/\/e-hentai\.org\/s\/\S+?(?=">)/g;
        for (const item of (chapterUrlsRawResponse.match(chapterUrlsPattern))) {
          chapterUrls.push(item)
        }
        semaphore.release()
      }
      const tasks = urls.map(cUrl => exec(cUrl))
      await Promise.all(tasks)
    }

    // Get image url.
    {
      const semaphore = new Semaphore(8, 8)
      const pageUrls = []
      const exec = async (item) => {
        await semaphore.waitAsync()
        const pageUrlsRawResponse = await window.Rulia.httpRequest({
          url: item,
          method: 'GET'
        })
        const pageUrl = (
          (pageUrlsRawResponse.match(/<img\sid="img"\s[^>]*>/)[0]).match(/src="(https?:\/\/\S+)"/)[1]
        ).replace(/src="|"/, '')
        pageUrls.push(pageUrl)
        semaphore.release()
      }

      const tasks = chapterUrls.map(item => exec(item))
      await Promise.all(tasks)

      const result = []
      for (var item of pageUrls) {
        result.push({
          url: item,
          width: 1,
          height: 1
        })
      }
      window.Rulia.endWithResult(result);
    }
  } catch (error) {
    window.Rulia.endWithException(error.message);
  }
}

async function getImageUrl(path) {
  window.Rulia.endWithResult(path);
}
