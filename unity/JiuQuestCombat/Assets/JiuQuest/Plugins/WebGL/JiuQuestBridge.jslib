mergeInto(LibraryManager.library, {
  JiuQuestEmit: function (payloadPointer) {
    try {
      var detail = JSON.parse(UTF8ToString(payloadPointer));
      window.dispatchEvent(new CustomEvent('jiuquest:unity', { detail: detail }));
    } catch (error) {
      console.error('JiuQuest Unity bridge event failed', error);
    }
  }
});
