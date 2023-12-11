interface IHentagApi<T> {
  works: T,
  page: number,
  pageSize: number
}

interface IHentagMangaListItem {
  title: string,
  id: string,
  coverImageUrl: string
}

class Semaphore {
  availablePermits: number;
  maxCount: number;
  waiters: (() => void)[];
  waitAsync() {
    return new Promise<void>((resolve) => {
      if (this.availablePermits > 0) {
        this.availablePermits--;
        resolve();
      } else {
        this.waiters.push(() => resolve());
      }
    });
  }
  release() {
    if (this.waiters.length > 0) {
      const resolve = this.waiters.shift();
      resolve?.(); // Invoke the resolve function
    } else if (this.availablePermits < this.maxCount) {
      this.availablePermits++;
    } else {
      throw new Error('Semaphore release error: max permit count exceeded.');
    }
  }
  constructor(initialCount: number, maxCount: number) {
    this.availablePermits = initialCount;
    this.maxCount = maxCount;
    this.waiters = [];
  }
}


async function getMangaList(page: number, pageSize: number, keyword: string) {
  const url = 'https://hentag.com/public/api/vault-search';
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
    });
    const response = JSON.parse(rawResponse) as IHentagApi<IHentagMangaListItem[]>;
    const result: IGetMangaListResult = {
      list: response.works.map(item => ({
        title: item.title,
        url: 'https://hentag.com/vault/' + item.id,
        coverUrl: item.coverImageUrl
      }))
    }
    window.Rulia.endWithResult(result);
  } catch (error) {
    window.Rulia.endWithException((error as Error).message);
  }
}

async function getMangaData(dataPageUrl: string) {
  const seasonIdMatchExp = /vault\/([^?]+)/;
  const seasonIdMatch: RegExpMatchArray | any = dataPageUrl.match(seasonIdMatchExp);
  const url = 'https://hentag.com/public/api/vault/' + seasonIdMatch[1];
  try {
    const rawResponse = await window.Rulia.httpRequest({
      url: url,
      method: 'GET'
    });
    const response = JSON.parse(rawResponse);
    const description = new Date(response.lastModified).toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' }).replace(/\//g, '-').replace(/-/g, '/');
    const result = {
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
    window.Rulia.endWithException((error as Error).message);
  }
}

async function getChapterImageList(chapterUrl: string) {
  try {
    const chapterRawHTML = await window.Rulia.httpRequest({
      url: chapterUrl,
      method: 'GET'
    })
    
    const totalImageCountPattern = /<td class="gdt2">(\d+)\s*pages?<\/td>/;
    const totalImageCountMatch = chapterRawHTML.match(totalImageCountPattern);
    if (!totalImageCountMatch) {
      return window.Rulia.endWithException('TOO_MANY_REQUESTS');
    }
    const totalImageCount = parseInt(totalImageCountMatch[1])
    
    const allImagePageUrls: string[] = []
    if (totalImageCount != 0) {
      const PAGE_SIZE = 40
      const pageCount = Math.ceil(totalImageCount / PAGE_SIZE)
      const chapterPageUrls = [];

      for (let i = 0; i < pageCount; i++) {
        chapterPageUrls.push(chapterUrl + '?p=' + i);
      }

      const semaphore = new Semaphore(5, 5);
      const httpReponsePool: { urls: string[], index: number }[] = []

      const parseChapterPage = async (chapterPageUrl: string, index: number) => {
        await semaphore.waitAsync();
        const chapterPageHTML: any = await window.Rulia.httpRequest({
          url: chapterPageUrl,
          method: 'GET'
        });
        
        const imagePageUrlPattern = /https:\/\/e-hentai\.org\/s\/\S+?(?=">)/g;
        const imagePageUrls = chapterPageHTML.match(imagePageUrlPattern)

        httpReponsePool.push({
          index,
          urls: imagePageUrls
        })

        semaphore.release()
      }

      const tasks = chapterPageUrls.map((url, index) => parseChapterPage(url, index))
      await Promise.all(tasks);

      httpReponsePool.sort((a, b) => a.index - b.index)
      for (const httpResponse of httpReponsePool) {
        allImagePageUrls.push(...httpResponse.urls)
      }
    }

    // Get image url.
    {
      const semaphore = new Semaphore(8, 8);
      const httpReponsePool: { src: string, index: number }[] = []

      const getImageUrl = async (imagePageUrl: string, index: number) => {
        await semaphore.waitAsync();
        const pageUrlsRawResponse: any = await window.Rulia.httpRequest({
          url: imagePageUrl,
          method: 'GET'
        })
        const imageSrc = (
          (pageUrlsRawResponse.match(/<img\sid="img"\s[^>]*>/)[0]).match(/src="(https?:\/\/\S+)"/)[1]
        ).replace(/src="|"/, '')
        httpReponsePool.push({
          index,
          src: imageSrc
        })
        semaphore.release()
      }

      const tasks = allImagePageUrls.map((item, index) => getImageUrl(item, index))
      await Promise.all(tasks)

      httpReponsePool.sort((a, b) => a.index - b.index)

      const imageUrls: string[] = httpReponsePool.map(item => item.src)
      window.Rulia.endWithResult(imageUrls.map(url => {
        return {
          url,
          width: 1,
          height: 1
        }
      }));
    }
  } catch (error) {
    window.Rulia.endWithException((error as Error).message);
  }
}

async function getImageUrl(path: string) {
  window.Rulia.endWithResult(path);
}
